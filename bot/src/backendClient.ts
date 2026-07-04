import { OfficeState, Device, UsageSnapshot, RoomEfficiency, EnergySuggestion } from "@drishti/shared";

const BASE_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`backend ${path} → ${res.status}`);
  return res.json();
}

export async function fetchFullState(): Promise<OfficeState> {
  return get<OfficeState>("/api/state");
}

export async function fetchUsage(): Promise<UsageSnapshot> {
  return get<UsageSnapshot>("/api/usage");
}

export async function fetchEfficiency(): Promise<RoomEfficiency[]> {
  return get<RoomEfficiency[]>("/api/efficiency");
}

export interface OfficeStats {
  timestamp: string;
  summary: {
    totalDevices: number;
    devicesOn: number;
    devicesFlapping: number;
    totalWatts: number;
    peakWattsToday: number;
    kwhToday: number;
    costToday: number;
    co2Today: number;
    projectedKwh: number;
  };
  alerts: {
    active: number;
    critical: number;
    warning: number;
    info: number;
    raisedToday: number;
  };
  rooms: Array<{
    room: string;
    devicesOn: number;
    devicesTotal: number;
    watts: number;
    activeAlerts: number;
    eventsToday: number;
  }>;
  flappingDevices: Array<{ id: string; label: string; room: string }>;
  topConsumerRoom: string | null;
  virtualClock: { hour: number; isOverridden: boolean };
}

export type { EnergySuggestion } from "@drishti/shared";

export async function fetchStats(): Promise<OfficeStats> {
  return get<OfficeStats>("/api/stats");
}

export async function fetchSuggestions(): Promise<EnergySuggestion[]> {
  return get<EnergySuggestion[]>("/api/suggestions");
}

export async function toggleRoom(roomId: string, state: boolean, kind?: "fan" | "light"): Promise<{ affected: number }> {
  const res = await fetch(`${BASE_URL}/api/rooms/${roomId}/toggle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state, ...(kind ? { kind } : {}) }),
  });
  if (!res.ok) throw new Error(`backend /api/rooms/${roomId}/toggle → ${res.status}`);
  return res.json();
}

export async function fetchEventsCsv(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/export/events.csv`);
  if (!res.ok) throw new Error(`backend /api/export/events.csv → ${res.status}`);
  return res.text();
}

export async function shutdownAllDevices(kind?: "fan" | "light", room?: string): Promise<{ shutDown: number }> {
  const res = await fetch(`${BASE_URL}/api/admin/shutdown-all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(kind ? { kind } : {}), ...(room ? { room } : {}) }),
  });
  if (!res.ok) throw new Error(`backend /api/admin/shutdown-all → ${res.status}`);
  return res.json();
}

export function findRoomDevices(state: OfficeState, roomQuery: string): { label: string; devices: Device[] } {
  const normalized = roomQuery.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliasMap: Record<string, string> = {
    drawing: "drawing_room",
    drawing_room: "drawing_room",
    "1": "work_room_1",
    work1: "work_room_1",
    work_1: "work_room_1",
    work_room_1: "work_room_1",
    workroom1: "work_room_1",
    "2": "work_room_2",
    work2: "work_room_2",
    work_2: "work_room_2",
    work_room_2: "work_room_2",
    workroom2: "work_room_2",
  };

  const roomId = aliasMap[normalized];
  if (!roomId) return { label: roomQuery, devices: [] };

  const LABELS: Record<string, string> = {
    drawing_room: "Drawing Room",
    work_room_1: "Work Room 1",
    work_room_2: "Work Room 2",
  };

  return {
    label: LABELS[roomId] ?? roomQuery,
    devices: state.devices.filter((d) => d.room === roomId),
  };
}
