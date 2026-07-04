import {
  Device,
  RoomId,
  ROOM_IDS,
  ROOM_LABELS,
  RoomUsage,
  UsageSnapshot,
  UsageHistoryPoint,
  BPDB_TARIFF_SLABS,
  BD_GRID_EMISSION_FACTOR_KG_PER_KWH,
} from "@drishti/shared";
import { deviceStore } from "../simulator/store";

function currentTotalWatts(devices: Device[]): number {
  return devices.filter((d) => d.isOn).reduce((sum, d) => sum + d.wattage, 0);
}

function perRoomUsage(devices: Device[]): RoomUsage[] {
  return ROOM_IDS.map((room) => {
    const roomDevices = devices.filter((d) => d.room === room);
    return {
      room,
      label: ROOM_LABELS[room],
      totalWatts: roomDevices.filter((d) => d.isOn).reduce((s, d) => s + d.wattage, 0),
      devicesOn: roomDevices.filter((d) => d.isOn).length,
      devicesTotal: roomDevices.length,
    };
  });
}

/**
 * Integrates actual event history to compute kWh consumed so far today,
 * rather than a naive "current watts * hours elapsed" approximation.
 * This is the same event-sourcing payoff described in store.ts.
 */
function estimateKwhToday(): number {
  const events = deviceStore.getAllEvents();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const now = Date.now();

  // Group events per device, walk chronologically, integrate watt-hours.
  const byDevice = new Map<string, typeof events>();
  for (const e of events) {
    if (!byDevice.has(e.deviceId)) byDevice.set(e.deviceId, []);
    byDevice.get(e.deviceId)!.push(e);
  }

  let totalWattHours = 0;
  for (const [deviceId, deviceEvents] of byDevice) {
    const sorted = [...deviceEvents].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    const device = deviceStore.getDevice(deviceId);
    if (!device) continue;

    let lastOnAt: number | null = null;
    for (const event of sorted) {
      const t = Math.max(new Date(event.timestamp).getTime(), startOfDay.getTime());
      if (event.isOn) {
        lastOnAt = t;
      } else if (lastOnAt !== null) {
        totalWattHours += (device.wattage * (t - lastOnAt)) / 3_600_000;
        lastOnAt = null;
      }
    }
    if (lastOnAt !== null) {
      totalWattHours += (device.wattage * (now - lastOnAt)) / 3_600_000;
    }
  }

  return totalWattHours / 1000; // Wh -> kWh
}

/** Slab-based cost calculation using BPDB-style tiered tariffs. */
function estimateCostBdt(kwh: number): number {
  let remaining = kwh;
  let cost = 0;
  let lowerBound = 0;

  for (const slab of BPDB_TARIFF_SLABS) {
    const slabCeiling = slab.uptoKwh ?? Infinity;
    const slabWidth = slabCeiling - lowerBound;
    const consumedInSlab = Math.min(remaining, slabWidth);
    if (consumedInSlab <= 0) break;
    cost += consumedInSlab * slab.ratePerKwh;
    remaining -= consumedInSlab;
    lowerBound = slabCeiling;
    if (remaining <= 0) break;
  }
  return Math.round(cost * 100) / 100;
}

/** Naive linear projection to a full 24h day based on elapsed-day consumption. */
function projectFullDayKwh(kwhSoFar: number): number {
  const now = new Date();
  const elapsedHours = now.getHours() + now.getMinutes() / 60;
  if (elapsedHours < 0.25) return kwhSoFar; // avoid divide-by-near-zero at midnight
  return Math.round((kwhSoFar / elapsedHours) * 24 * 100) / 100;
}

export function computeUsageSnapshot(): UsageSnapshot {
  const devices = deviceStore.getAllDevices();
  const totalWatts = currentTotalWatts(devices);
  const kwhToday = Math.round(estimateKwhToday() * 1000) / 1000;
  const costBdt = estimateCostBdt(kwhToday);
  const co2Kg = Math.round(kwhToday * BD_GRID_EMISSION_FACTOR_KG_PER_KWH * 1000) / 1000;
  const projected = projectFullDayKwh(kwhToday);

  return {
    timestamp: new Date().toISOString(),
    totalWatts,
    perRoom: perRoomUsage(devices),
    estimatedKwhToday: kwhToday,
    estimatedCostBdt: costBdt,
    estimatedCo2Kg: co2Kg,
    projectedKwhFullDay: projected,
  };
}

/**
 * Buckets today's timeline into fixed intervals and reconstructs total
 * wattage at each bucket boundary from the event log (via
 * deviceStore.getWattageAt). This powers the dashboard's power-history
 * chart with a real reconstruction, not a client-side running average.
 */
export function computeUsageHistory(bucketMinutes = 30): UsageHistoryPoint[] {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const now = Date.now();
  const bucketMs = bucketMinutes * 60_000;

  const points: UsageHistoryPoint[] = [];
  for (let t = startOfDay.getTime(); t <= now; t += bucketMs) {
    const iso = new Date(t).toISOString();
    points.push({ timestamp: iso, watts: deviceStore.getWattageAt(iso) });
  }
  // Always include "right now" as the final point so the chart isn't stale
  // by up to one bucket width.
  points.push({ timestamp: new Date(now).toISOString(), watts: currentTotalWatts(deviceStore.getAllDevices()) });
  return points;
}

/** CSV export of today's raw event log, used by both the REST endpoint and the Discord !export command. */
export function exportTodayEventsCsv(): string {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const events = deviceStore.getEventsSince(startOfDay.toISOString());
  const header = "timestamp,device_id,room,is_on,wattage_at_change";
  const rows = events.map(
    (e) => `${e.timestamp},${e.deviceId},${e.room},${e.isOn},${e.wattageAtChange}`
  );
  return [header, ...rows].join("\n");
}
