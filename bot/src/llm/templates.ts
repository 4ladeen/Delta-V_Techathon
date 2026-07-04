import { OfficeState, ROOM_LABELS, ROOM_IDS } from "@drishti/shared";

const OPENERS = [
  "Quick office check —",
  "Here's the latest:",
  "Status report:",
  "Live from the office —",
  "Alright, here's what's on:",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function statusTemplate(state: OfficeState): string {
  const roomLines = ROOM_IDS.map((room) => {
    const devices = state.devices.filter((d) => d.room === room);
    const on = devices.filter((d) => d.isOn);
    if (on.length === 0) return `${ROOM_LABELS[room]}: all off`;
    const fans = on.filter((d) => d.kind === "fan").length;
    const lights = on.filter((d) => d.kind === "light").length;
    const watts = on.reduce((s, d) => s + d.wattage, 0);
    const parts: string[] = [];
    if (fans) parts.push(`${fans} fan${fans > 1 ? "s" : ""}`);
    if (lights) parts.push(`${lights} light${lights > 1 ? "s" : ""}`);
    return `${ROOM_LABELS[room]}: ${parts.join(", ")} ON (${watts}W)`;
  });
  const totalOn = state.devices.filter((d) => d.isOn).length;
  const totalWatts = state.usage.totalWatts;
  return `${pick(OPENERS)} ${roomLines.join(". ")}. Total: ${totalOn}/${state.devices.length} devices on at ${totalWatts}W.`;
}

export function roomTemplate(
  state: OfficeState,
  roomLabel: string,
  devices: OfficeState["devices"]
): string {
  if (devices.length === 0) {
    return `Couldn't find a room called "${roomLabel}". Try: drawing room, work room 1, or work room 2.`;
  }
  const on = devices.filter((d) => d.isOn);
  if (on.length === 0) return `${roomLabel} is fully powered down — nothing running right now.`;
  const watts = on.reduce((s, d) => s + d.wattage, 0);
  const list = on.map((d) => d.label).join(", ");
  return `${roomLabel} has ${on.length}/${devices.length} devices on (${list}) drawing ${watts}W.`;
}

export function usageTemplate(state: OfficeState): string {
  const { totalWatts, estimatedKwhToday, estimatedCostBdt, estimatedCo2Kg, projectedKwhFullDay } = state.usage;
  return (
    `Live draw: ${totalWatts}W. ` +
    `Today so far: ${estimatedKwhToday.toFixed(3)} kWh · ৳${estimatedCostBdt.toFixed(2)} · ${estimatedCo2Kg.toFixed(3)}kg CO₂. ` +
    `At this pace, projected daily usage is ${projectedKwhFullDay.toFixed(2)} kWh.`
  );
}

export function alertAnnouncementTemplate(message: string, severity: string): string {
  const emoji = severity === "critical" ? "🔥" : severity === "warning" ? "⚠️" : "ℹ️";
  const urgency = severity === "critical" ? "Action required" : severity === "warning" ? "Heads up" : "FYI";
  return `${emoji} **${urgency}** — ${message}`;
}

export function statsTemplate(state: OfficeState): string {
  const on = state.devices.filter((d) => d.isOn);
  const flapping = state.devices.filter((d) => d.isFlapping);
  const alerts = state.alerts.filter((a) => !a.acknowledged);
  const topRoom = state.usage.perRoom.sort((a, b) => b.totalWatts - a.totalWatts)[0];
  return (
    `Office stats: ${on.length}/${state.devices.length} devices on · ${state.usage.totalWatts}W live · ` +
    `${alerts.length} active alerts · ${flapping.length} flapping device(s). ` +
    `Top consumer: ${topRoom?.label ?? "—"} at ${topRoom?.totalWatts ?? 0}W.`
  );
}
