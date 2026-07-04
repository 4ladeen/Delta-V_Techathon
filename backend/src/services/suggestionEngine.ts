import { Device, ROOM_LABELS, EnergySuggestion } from "@drishti/shared";
import { deviceStore } from "../simulator/store";
import { computeUsageSnapshot } from "./usageEngine";

/**
 * Generates contextual, actionable energy-saving suggestions based on
 * current office state. Each suggestion is concrete ("turn off X"), not
 * generic advice — grounded in real device state.
 */
export function generateSuggestions(): EnergySuggestion[] {
  const devices = deviceStore.getAllDevices();
  const hour = deviceStore.getVirtualHour();
  const occupancy = deviceStore.getOccupancy();
  const usage = computeUsageSnapshot();
  const nowIso = new Date().toISOString();
  const suggestions: EnergySuggestion[] = [];

  const isOffHours = hour < 9 || hour >= 17;
  const isLunchBreak = hour === 12 || hour === 13;

  // 1. After-hours devices left on
  if (isOffHours) {
    const onDevices = devices.filter((d) => d.isOn);
    if (onDevices.length > 0) {
      const watts = onDevices.reduce((s, d) => s + d.wattage, 0);
      suggestions.push({
        id: "after_hours_shutdown",
        priority: "high",
        action: `Turn off ${onDevices.length} device(s) — it's outside office hours`,
        reason: `${onDevices.length} device(s) running after hours waste roughly ৳${(watts * 0.001 * 12.67).toFixed(2)}/hour`,
        estimatedSavingWatts: watts,
        rooms: [...new Set(onDevices.map((d) => ROOM_LABELS[d.room]))],
      });
    }
  }

  // 2. Empty rooms with devices on
  for (const signal of occupancy) {
    if (signal.occupied) continue;
    const roomOn = devices.filter((d) => d.room === signal.room && d.isOn);
    if (roomOn.length === 0) continue;
    const watts = roomOn.reduce((s, d) => s + d.wattage, 0);
    suggestions.push({
      id: `empty_room_${signal.room}`,
      priority: "medium",
      action: `Turn off ${roomOn.length} device(s) in ${ROOM_LABELS[signal.room]}`,
      reason: `Room appears unoccupied but has ${roomOn.length} device(s) drawing ${watts}W`,
      estimatedSavingWatts: watts,
      rooms: [ROOM_LABELS[signal.room]],
    });
  }

  // 3. Lunch-break suggestion
  if (isLunchBreak) {
    const lightsOn = devices.filter((d) => d.kind === "light" && d.isOn);
    if (lightsOn.length > 0) {
      const watts = lightsOn.reduce((s, d) => s + d.wattage, 0);
      suggestions.push({
        id: "lunch_lights",
        priority: "low",
        action: `Consider dimming ${lightsOn.length} light(s) during lunch break`,
        reason: `Lunch hour — natural light is often sufficient. Saves ${watts}W`,
        estimatedSavingWatts: watts,
        rooms: [...new Set(lightsOn.map((d) => ROOM_LABELS[d.room]))],
      });
    }
  }

  // 4. Long-running fans with lights off (fan without light = dark but breezy, odd)
  for (const room of ["drawing_room", "work_room_1", "work_room_2"] as const) {
    const fansOn = devices.filter((d) => d.room === room && d.kind === "fan" && d.isOn);
    const lightsOn = devices.filter((d) => d.room === room && d.kind === "light" && d.isOn);
    if (fansOn.length > 0 && lightsOn.length === 0) {
      const continuousMinutes = fansOn.reduce(
        (max, f) => Math.max(max, deviceStore.getContinuousOnMinutes(f.id, nowIso)),
        0
      );
      if (continuousMinutes > 60) {
        suggestions.push({
          id: `fan_no_light_${room}`,
          priority: "low",
          action: `Fan(s) running in dark ${ROOM_LABELS[room]} — room possibly unattended`,
          reason: `${fansOn.length} fan(s) on for ${Math.round(continuousMinutes)}min with no lights — unusual pattern`,
          estimatedSavingWatts: fansOn.reduce((s, d) => s + d.wattage, 0),
          rooms: [ROOM_LABELS[room]],
        });
      }
    }
  }

  // 5. High consumption projection
  if (usage.projectedKwhFullDay > 1.5) {
    suggestions.push({
      id: "high_projection",
      priority: "medium",
      action: "Reduce active devices to lower today's projected consumption",
      reason: `At current pace: ${usage.projectedKwhFullDay.toFixed(2)} kWh/day → ৳${(usage.projectedKwhFullDay * 12.67).toFixed(2)} estimated`,
      estimatedSavingWatts: Math.round(usage.totalWatts * 0.25),
      rooms: usage.perRoom.filter((r) => r.totalWatts > 0).map((r) => r.label),
    });
  }

  return suggestions.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.priority] - order[b.priority];
  });
}
