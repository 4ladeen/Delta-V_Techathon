import { randomUUID } from "crypto";
import {
  Device,
  DeviceEvent,
  DeviceKind,
  RoomId,
  ROOM_IDS,
  DEVICE_WATTAGE,
  OccupancySignal,
} from "@drishti/shared";

/**
 * DeviceStore is the single source of truth for office state.
 * It is event-sourced: every state change is appended to an event log.
 * Current device state is a projection of that log, which means:
 *   - "on for >2h continuously" is computed from real event history,
 *     not approximated from a single "lastChanged" field
 *   - historical charts (hourly usage, activity heatmap) come for free
 *   - the admin "force anomaly" endpoint can backdate events honestly
 *     rather than faking a snapshot
 *
 * This is intentionally an in-memory store with an append-only array
 * for the event log. For a hackathon demo this is the right trade-off:
 * zero external dependencies, trivial to run anywhere, and fast.
 * Swapping the persistence layer for SQLite/Postgres later only
 * requires changing this file — everything else consumes the same
 * public interface below.
 */

const ROOM_DEVICE_SPEC: { kind: DeviceKind; count: number }[] = [
  { kind: "fan", count: 2 },
  { kind: "light", count: 3 },
];

function buildInitialDevices(): Device[] {
  const now = new Date().toISOString();
  const devices: Device[] = [];
  for (const room of ROOM_IDS) {
    for (const spec of ROOM_DEVICE_SPEC) {
      for (let i = 1; i <= spec.count; i++) {
        devices.push({
          id: `${room}_${spec.kind}_${i}`,
          kind: spec.kind,
          room,
          label: `${spec.kind === "fan" ? "Fan" : "Light"} ${i}`,
          isOn: false,
          wattage: DEVICE_WATTAGE[spec.kind],
          lastChanged: now,
          isFlapping: false,
        });
      }
    }
  }
  return devices;
}

class DeviceStore {
  private devices: Map<string, Device>;
  private events: DeviceEvent[] = [];
  private occupancy: Map<RoomId, OccupancySignal>;
  private virtualHourOverride: number | null = null;

  constructor() {
    const initial = buildInitialDevices();
    this.devices = new Map(initial.map((d) => [d.id, d]));
    this.occupancy = new Map(
      ROOM_IDS.map((room) => [
        room,
        { room, occupied: false, lastChanged: new Date().toISOString() },
      ])
    );
  }

  // ---- Reads --------------------------------------------------------

  getAllDevices(): Device[] {
    return Array.from(this.devices.values());
  }

  getDevice(id: string): Device | undefined {
    return this.devices.get(id);
  }

  getEventsSince(sinceIso: string): DeviceEvent[] {
    const since = new Date(sinceIso).getTime();
    return this.events.filter((e) => new Date(e.timestamp).getTime() >= since);
  }

  getAllEvents(): DeviceEvent[] {
    return this.events;
  }

  getOccupancy(): OccupancySignal[] {
    return Array.from(this.occupancy.values());
  }

  /** Current hour 0-23, respecting a demo-time override if set. */
  getVirtualHour(): number {
    if (this.virtualHourOverride !== null) return this.virtualHourOverride;
    return new Date().getHours();
  }

  isHourOverridden(): boolean {
    return this.virtualHourOverride !== null;
  }

  /**
   * Continuous "on" duration in minutes for a device, computed from the
   * event log rather than trusting a single flag. Walks backward through
   * events until it finds the most recent "off" (or start of log).
   */
  getContinuousOnMinutes(deviceId: string, nowIso: string): number {
    const device = this.devices.get(deviceId);
    if (!device || !device.isOn) return 0;

    const deviceEvents = this.events
      .filter((e) => e.deviceId === deviceId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    let onSince = device.lastChanged;
    for (let i = deviceEvents.length - 1; i >= 0; i--) {
      if (!deviceEvents[i].isOn) break; // hit the prior "off" — stop
      onSince = deviceEvents[i].timestamp;
    }
    const diffMs = new Date(nowIso).getTime() - new Date(onSince).getTime();
    return Math.max(0, diffMs / 60000);
  }

  /** True if a device has flipped state 3+ times in the trailing 5 minutes. */
  computeFlapping(deviceId: string, nowIso: string): boolean {
    const fiveMinAgo = new Date(nowIso).getTime() - 5 * 60 * 1000;
    const recentFlips = this.events.filter(
      (e) => e.deviceId === deviceId && new Date(e.timestamp).getTime() >= fiveMinAgo
    );
    return recentFlips.length >= 3;
  }

  /**
   * Reconstructs total office wattage at an arbitrary past instant by
   * replaying each device's event history up to that moment. This is what
   * makes the power-history chart a real reconstruction rather than an
   * interpolated guess between two snapshots — same event-sourcing payoff
   * used everywhere else in this store.
   */
  getWattageAt(atIso: string): number {
    const at = new Date(atIso).getTime();
    let total = 0;
    for (const device of this.devices.values()) {
      const priorEvents = this.events
        .filter((e) => e.deviceId === device.id && new Date(e.timestamp).getTime() <= at)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const last = priorEvents[priorEvents.length - 1];
      const isOnAt = last ? last.isOn : false;
      if (isOnAt) total += device.wattage;
    }
    return total;
  }

  // ---- Writes ---------------------------------------------------------

  /** Toggle a device, recording an event. Returns the updated device. */
  setDeviceState(deviceId: string, isOn: boolean, atIso?: string): Device | null {
    const device = this.devices.get(deviceId);
    if (!device) return null;
    const timestamp = atIso ?? new Date().toISOString();

    if (device.isOn === isOn) {
      // No-op state-wise, but still useful for flap-testing scenarios;
      // skip recording a duplicate event to keep the log meaningful.
      return device;
    }

    device.isOn = isOn;
    device.lastChanged = timestamp;
    this.devices.set(deviceId, device);

    const event: DeviceEvent = {
      id: randomUUID(),
      deviceId,
      room: device.room,
      isOn,
      timestamp,
      wattageAtChange: isOn ? device.wattage : 0,
    };
    this.events.push(event);

    device.isFlapping = this.computeFlapping(deviceId, timestamp);
    return device;
  }

  toggleDevice(deviceId: string): Device | null {
    const device = this.devices.get(deviceId);
    if (!device) return null;
    return this.setDeviceState(deviceId, !device.isOn);
  }

  setOccupancy(room: RoomId, occupied: boolean): void {
    this.occupancy.set(room, { room, occupied, lastChanged: new Date().toISOString() });
  }

  /** Admin: pin the virtual clock to a specific hour for demo purposes. */
  overrideHour(hour: number): void {
    this.virtualHourOverride = Math.max(0, Math.min(23, hour));
  }

  clearHourOverride(): void {
    this.virtualHourOverride = null;
  }

  /**
   * Admin: force every device in a room ON and backdate their "on since"
   * event by `hoursAgo`, so continuous-run and after-hours alerts fire
   * deterministically during a live demo instead of hoping timing lines up.
   */
  forceAnomaly(room: RoomId, hoursAgo: number): Device[] {
    const backdated = new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
    const affected: Device[] = [];
    for (const device of this.devices.values()) {
      if (device.room !== room) continue;
      device.isOn = true;
      device.lastChanged = backdated;
      this.devices.set(device.id, device);
      this.events.push({
        id: randomUUID(),
        deviceId: device.id,
        room: device.room,
        isOn: true,
        timestamp: backdated,
        wattageAtChange: device.wattage,
      });
      affected.push(device);
    }
    return affected;
  }
}

export const deviceStore = new DeviceStore();
