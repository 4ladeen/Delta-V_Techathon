// ============================================================================
// Drishti (দৃষ্টি) — Shared Type Contract
// This file is the single source of truth for data shapes across
// backend, discord bot, and frontend. Never duplicate these types elsewhere.
// ============================================================================

export type DeviceKind = "fan" | "light";

export type RoomId = "drawing_room" | "work_room_1" | "work_room_2";

export const ROOM_LABELS: Record<RoomId, string> = {
  drawing_room: "Drawing Room",
  work_room_1: "Work Room 1",
  work_room_2: "Work Room 2",
};

export const ROOM_IDS: RoomId[] = ["drawing_room", "work_room_1", "work_room_2"];

/** Realistic wattage draw per device kind when ON. */
export const DEVICE_WATTAGE: Record<DeviceKind, number> = {
  fan: 60,
  light: 15,
};

export interface Device {
  id: string; // e.g. "work_room_1_fan_1"
  kind: DeviceKind;
  room: RoomId;
  label: string; // e.g. "Fan 1", "Light 3"
  isOn: boolean;
  wattage: number; // draw when on, 0 when off is derived, not stored
  lastChanged: string; // ISO timestamp
  /** True if the device has flipped state 3+ times in the last 5 min ("phantom load"). */
  isFlapping: boolean;
}

/** A single state-change event, used for history, charts, and alert logic. */
export interface DeviceEvent {
  id: string;
  deviceId: string;
  room: RoomId;
  isOn: boolean;
  timestamp: string; // ISO
  wattageAtChange: number;
}

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertType =
  | "after_hours"
  | "continuous_run"
  | "phantom_load"
  | "occupancy_mismatch";

export interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  room: RoomId;
  deviceId?: string;
  message: string;
  createdAt: string; // ISO
  acknowledged: boolean;
}

export interface RoomUsage {
  room: RoomId;
  label: string;
  totalWatts: number;
  devicesOn: number;
  devicesTotal: number;
}

export interface UsageSnapshot {
  timestamp: string;
  totalWatts: number;
  perRoom: RoomUsage[];
  estimatedKwhToday: number;
  estimatedCostBdt: number;
  estimatedCo2Kg: number;
  projectedKwhFullDay: number;
}

export interface OccupancySignal {
  room: RoomId;
  occupied: boolean;
  lastChanged: string;
}

/** Full state pushed to clients on connect and on every mutation. */
export interface OfficeState {
  devices: Device[];
  usage: UsageSnapshot;
  alerts: Alert[];
  occupancy: OccupancySignal[];
  virtualClock: {
    isoTime: string;
    hour: number; // 0-23, overridable for demo purposes
    isOverridden: boolean;
  };
}

// ---- Socket.IO event contract -------------------------------------------

export interface ServerToClientEvents {
  "state:full": (state: OfficeState) => void;
  "state:devices": (devices: Device[]) => void;
  "state:usage": (usage: UsageSnapshot) => void;
  "state:alerts": (alerts: Alert[]) => void;
  "alert:new": (alert: Alert) => void;
}

export interface ClientToServerEvents {
  "device:toggle": (deviceId: string) => void;
}

// ---- BPDB (Bangladesh Power Development Board) tariff slabs -------------
// Approximate residential/commercial slab structure used for the cost engine.
// Source values are illustrative for demo purposes; documented in README.

export interface TariffSlab {
  uptoKwh: number | null; // null = no upper bound
  ratePerKwh: number; // BDT
}

export const BPDB_TARIFF_SLABS: TariffSlab[] = [
  { uptoKwh: 75, ratePerKwh: 4.63 },
  { uptoKwh: 200, ratePerKwh: 5.26 },
  { uptoKwh: 300, ratePerKwh: 7.2 },
  { uptoKwh: 400, ratePerKwh: 7.59 },
  { uptoKwh: 600, ratePerKwh: 8.02 },
  { uptoKwh: null, ratePerKwh: 12.67 },
];

/** Bangladesh grid emission factor, kg CO2 per kWh (approximate, documented). */
export const BD_GRID_EMISSION_FACTOR_KG_PER_KWH = 0.63;

// ---- New in v1.1: efficiency scoring + power history -----------------

export interface UsageHistoryPoint {
  timestamp: string;
  watts: number;
}

export type EfficiencyGrade = "A" | "B" | "C" | "D" | "F";

export interface RoomEfficiency {
  room: RoomId;
  label: string;
  score: number; // 0-100
  grade: EfficiencyGrade;
  incidentsToday: number;
}

// ---- Contextual energy-saving suggestions --------------------------------

export interface EnergySuggestion {
  id: string;
  priority: "high" | "medium" | "low";
  action: string;
  reason: string;
  estimatedSavingWatts: number;
  rooms: string[];
}

