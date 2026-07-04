import { randomUUID } from "crypto";
import { Alert, ROOM_LABELS } from "@drishti/shared";
import { deviceStore } from "../simulator/store";

const OFFICE_HOURS_START = 9;
const OFFICE_HOURS_END = 17;
const CONTINUOUS_RUN_THRESHOLD_MIN = 120; // 2 hours, per spec

// In-memory de-dupe so we don't spam a fresh alert every tick for the
// same ongoing condition. Keyed by a stable signature per condition.
const activeAlertKeys = new Map<string, Alert>();

// Append-only history of every alert ever raised (independent of whether
// it's still active). This is what the efficiency score is computed from —
// a room's score reflects its track record today, not just its current
// snapshot, so clearing an alert doesn't erase the fact it happened.
const alertHistory: Alert[] = [];

export function getAlertHistorySince(sinceIso: string): Alert[] {
  const since = new Date(sinceIso).getTime();
  return alertHistory.filter((a) => new Date(a.createdAt).getTime() >= since);
}

function upsertAlert(key: string, build: () => Omit<Alert, "id" | "createdAt" | "acknowledged">): Alert {
  const existing = activeAlertKeys.get(key);
  if (existing) return existing;
  const alert: Alert = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    acknowledged: false,
    ...build(),
  };
  activeAlertKeys.set(key, alert);
  alertHistory.push(alert);
  return alert;
}

function clearAlert(key: string): void {
  activeAlertKeys.delete(key);
}

export function acknowledgeAlert(alertId: string): boolean {
  for (const [key, alert] of activeAlertKeys) {
    if (alert.id === alertId) {
      activeAlertKeys.set(key, { ...alert, acknowledged: true });
      return true;
    }
  }
  return false;
}

/**
 * Recomputes all active alerts from current device/event state.
 * Called on every simulator tick and after every manual toggle,
 * so the alerts panel is always consistent with what's on screen.
 */
export function evaluateAlerts(): Alert[] {
  const devices = deviceStore.getAllDevices();
  const hour = deviceStore.getVirtualHour();
  const nowIso = new Date().toISOString();
  const isAfterHours = hour < OFFICE_HOURS_START || hour >= OFFICE_HOURS_END;

  const seenKeysThisPass = new Set<string>();

  // --- 1. After-hours: any device on outside 9-5 ---
  for (const device of devices) {
    if (!device.isOn) continue;
    const key = `after_hours:${device.id}`;
    if (isAfterHours) {
      seenKeysThisPass.add(key);
      upsertAlert(key, () => ({
        type: "after_hours",
        severity: "warning",
        room: device.room,
        deviceId: device.id,
        message: `${device.label} in ${ROOM_LABELS[device.room]} is still on outside office hours (9AM-5PM).`,
      }));
    }
  }

  // --- 2. Continuous run > 2h, evaluated per room (per spec wording) ---
  const roomIds = Array.from(new Set(devices.map((d) => d.room)));
  for (const room of roomIds) {
    const roomDevices = devices.filter((d) => d.room === room && d.isOn);
    if (roomDevices.length === 0) continue;
    const allContinuous = roomDevices.every(
      (d) => deviceStore.getContinuousOnMinutes(d.id, nowIso) >= CONTINUOUS_RUN_THRESHOLD_MIN
    );
    const key = `continuous_run:${room}`;
    if (allContinuous) {
      seenKeysThisPass.add(key);
      upsertAlert(key, () => ({
        type: "continuous_run",
        severity: "critical",
        room,
        message: `${ROOM_LABELS[room]} has had every active device running continuously for 2+ hours.`,
      }));
    }
  }

  // --- 3. Phantom load: device flapping on/off rapidly ---
  for (const device of devices) {
    const flapping = deviceStore.computeFlapping(device.id, nowIso);
    const key = `phantom_load:${device.id}`;
    if (flapping) {
      seenKeysThisPass.add(key);
      upsertAlert(key, () => ({
        type: "phantom_load",
        severity: "warning",
        room: device.room,
        deviceId: device.id,
        message: `${device.label} in ${ROOM_LABELS[device.room]} is flickering on/off rapidly — possible faulty switch or wiring.`,
      }));
    }
  }

  // --- 4. Occupancy mismatch: devices active, room reads empty ---
  for (const signal of deviceStore.getOccupancy()) {
    const roomDevicesOn = devices.filter((d) => d.room === signal.room && d.isOn);
    const key = `occupancy_mismatch:${signal.room}`;
    if (!signal.occupied && roomDevicesOn.length >= 2) {
      seenKeysThisPass.add(key);
      upsertAlert(key, () => ({
        type: "occupancy_mismatch",
        severity: "info",
        room: signal.room,
        message: `${ROOM_LABELS[signal.room]} shows ${roomDevicesOn.length} devices active but no occupancy detected.`,
      }));
    }
  }

  // Clear any previously active alert whose condition no longer holds.
  for (const key of Array.from(activeAlertKeys.keys())) {
    if (!seenKeysThisPass.has(key)) clearAlert(key);
  }

  return Array.from(activeAlertKeys.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getActiveAlerts(): Alert[] {
  return Array.from(activeAlertKeys.values());
}
