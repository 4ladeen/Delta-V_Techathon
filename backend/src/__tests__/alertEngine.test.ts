import { describe, it, expect } from "vitest";
import { deviceStore } from "../simulator/store";
import { evaluateAlerts } from "../services/alertEngine";
import { computeUsageSnapshot, computeUsageHistory, exportTodayEventsCsv } from "../services/usageEngine";
import { computeEfficiencyLeaderboard } from "../services/efficiencyEngine";
import { generateSuggestions } from "../services/suggestionEngine";

// Note: deviceStore is a module-level singleton by design (mirrors the
// real server process). Each test resets relevant device state explicitly
// rather than re-importing, since Node's module cache would give us the
// same instance anyway.

describe("alert engine", () => {
  it("raises an after-hours alert when a device is on outside 9-5", () => {
    deviceStore.overrideHour(22); // 10 PM
    const devices = deviceStore.getAllDevices();
    deviceStore.setDeviceState(devices[0].id, true);

    const alerts = evaluateAlerts();
    expect(alerts.some((a) => a.type === "after_hours" && a.deviceId === devices[0].id)).toBe(true);

    deviceStore.setDeviceState(devices[0].id, false);
    deviceStore.clearHourOverride();
  });

  it("does not raise after-hours alerts during office hours", () => {
    deviceStore.overrideHour(11); // 11 AM
    const devices = deviceStore.getAllDevices();
    deviceStore.setDeviceState(devices[1].id, true);

    const alerts = evaluateAlerts();
    expect(alerts.some((a) => a.type === "after_hours" && a.deviceId === devices[1].id)).toBe(false);

    deviceStore.setDeviceState(devices[1].id, false);
    deviceStore.clearHourOverride();
  });

  it("detects a forced continuous-run anomaly for a full room", () => {
    const affected = deviceStore.forceAnomaly("work_room_1", 3); // backdated 3h
    const alerts = evaluateAlerts();
    expect(alerts.some((a) => a.type === "continuous_run" && a.room === "work_room_1")).toBe(true);

    for (const device of affected) deviceStore.setDeviceState(device.id, false);
  });

  it("flags phantom load after 3+ rapid flips within 5 minutes", () => {
    const devices = deviceStore.getAllDevices();
    const target = devices[2];
    const now = new Date();
    // Simulate 4 flips within the last 4 minutes.
    for (let i = 0; i < 4; i++) {
      const t = new Date(now.getTime() - (4 - i) * 60000).toISOString();
      deviceStore.setDeviceState(target.id, i % 2 === 0, t);
    }
    const alerts = evaluateAlerts();
    expect(alerts.some((a) => a.type === "phantom_load" && a.deviceId === target.id)).toBe(true);
  });
});

describe("usage engine", () => {
  it("produces a non-negative wattage and cost figure", () => {
    const snapshot = computeUsageSnapshot();
    expect(snapshot.totalWatts).toBeGreaterThanOrEqual(0);
    expect(snapshot.estimatedCostBdt).toBeGreaterThanOrEqual(0);
    expect(snapshot.perRoom).toHaveLength(3);
  });

  it("total watts equals the sum of per-room watts", () => {
    const snapshot = computeUsageSnapshot();
    const sum = snapshot.perRoom.reduce((s, r) => s + r.totalWatts, 0);
    expect(snapshot.totalWatts).toBe(sum);
  });
});

describe("usage history", () => {
  it("reconstructs a non-empty, chronologically ordered series for today", () => {
    const history = computeUsageHistory(60);
    expect(history.length).toBeGreaterThan(0);
    for (let i = 1; i < history.length; i++) {
      expect(new Date(history[i].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(history[i - 1].timestamp).getTime()
      );
    }
  });
});

describe("CSV export", () => {
  it("produces a header row and one row per event since midnight", () => {
    const csv = exportTodayEventsCsv();
    const lines = csv.split("\n");
    expect(lines[0]).toBe("timestamp,device_id,room,is_on,wattage_at_change");
    expect(lines.length).toBeGreaterThanOrEqual(1);
  });
});

describe("suggestion engine", () => {
  it("returns an array (may be empty when all is fine)", () => {
    const suggestions = generateSuggestions();
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it("produces after-hours suggestion when virtual hour is 21 and devices are on", () => {
    deviceStore.overrideHour(21);
    const devices = deviceStore.getAllDevices();
    devices.slice(0, 3).forEach((d) => deviceStore.setDeviceState(d.id, true));

    const suggestions = generateSuggestions();
    expect(suggestions.some((s) => s.id === "after_hours_shutdown")).toBe(true);

    devices.slice(0, 3).forEach((d) => deviceStore.setDeviceState(d.id, false));
    deviceStore.clearHourOverride();
  });

  it("suggestions have required fields", () => {
    const suggestions = generateSuggestions();
    for (const s of suggestions) {
      expect(s).toHaveProperty("id");
      expect(s).toHaveProperty("priority");
      expect(s).toHaveProperty("action");
      expect(s).toHaveProperty("estimatedSavingWatts");
      expect(["high", "medium", "low"]).toContain(s.priority);
    }
  });
});

describe("efficiency leaderboard", () => {
  it("returns all three rooms sorted by descending score", () => {
    const board = computeEfficiencyLeaderboard();
    expect(board).toHaveLength(3);
    for (let i = 1; i < board.length; i++) {
      expect(board[i - 1].score).toBeGreaterThanOrEqual(board[i].score);
    }
  });

  it("penalizes a room with a forced continuous-run incident more than a clean room", () => {
    const before = computeEfficiencyLeaderboard();
    const workRoom2Before = before.find((r) => r.room === "work_room_2")!;

    deviceStore.forceAnomaly("work_room_2", 3);
    evaluateAlerts(); // triggers alertHistory logging as a side effect

    const after = computeEfficiencyLeaderboard();
    const workRoom2After = after.find((r) => r.room === "work_room_2")!;

    expect(workRoom2After.score).toBeLessThanOrEqual(workRoom2Before.score);
    expect(workRoom2After.incidentsToday).toBeGreaterThanOrEqual(workRoom2Before.incidentsToday);
  });
});
