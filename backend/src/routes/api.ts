import { Router, Request, Response } from "express";
import { deviceStore } from "../simulator/store";
import { computeUsageSnapshot, computeUsageHistory, exportTodayEventsCsv } from "../services/usageEngine";
import { evaluateAlerts, acknowledgeAlert, getAlertHistorySince } from "../services/alertEngine";
import { computeEfficiencyLeaderboard } from "../services/efficiencyEngine";
import { generateSuggestions } from "../services/suggestionEngine";
import { RoomId, ROOM_IDS, OfficeState } from "@drishti/shared";
import { broadcastFullState, broadcastDevices, io } from "../ws/socket";

export const apiRouter = Router();

// GET /api/health — standard health check
apiRouter.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() });
});

export function buildFullState(): OfficeState {
  return {
    devices: deviceStore.getAllDevices(),
    usage: computeUsageSnapshot(),
    alerts: evaluateAlerts(),
    occupancy: deviceStore.getOccupancy(),
    virtualClock: {
      isoTime: new Date().toISOString(),
      hour: deviceStore.getVirtualHour(),
      isOverridden: deviceStore.isHourOverridden(),
    },
  };
}

// GET /api/state
apiRouter.get("/state", (_req: Request, res: Response) => {
  res.json(buildFullState());
});

// GET /api/devices
apiRouter.get("/devices", (_req: Request, res: Response) => {
  res.json(deviceStore.getAllDevices());
});

// POST /api/devices/:id/toggle
apiRouter.post("/devices/:id/toggle", (req: Request, res: Response) => {
  const updated = deviceStore.toggleDevice(req.params.id);
  if (!updated) return res.status(404).json({ error: "device not found" });
  broadcastDevices();
  io.emit("state:alerts", evaluateAlerts());
  broadcastFullState(buildFullState());
  res.json(updated);
});

// POST /api/rooms/:roomId/toggle — turn devices in a room on or off
// Body: { state?: boolean, kind?: "fan" | "light" } — kind filter is optional
apiRouter.post("/rooms/:roomId/toggle", (req: Request, res: Response) => {
  const room = req.params.roomId as RoomId;
  if (!ROOM_IDS.includes(room)) {
    return res.status(400).json({ error: `room must be one of ${ROOM_IDS.join(", ")}` });
  }
  const { state, kind } = req.body as { state?: boolean; kind?: "fan" | "light" };
  let devices = deviceStore.getAllDevices().filter((d) => d.room === room);
  if (kind === "fan" || kind === "light") devices = devices.filter((d) => d.kind === kind);
  const targetState = state !== undefined ? state : !devices.some((d) => d.isOn);
  const updated = devices.map((d) => deviceStore.setDeviceState(d.id, targetState)).filter(Boolean);
  broadcastFullState(buildFullState());
  res.json({ room, kind: kind ?? "all", turnedOn: targetState, affected: updated.length });
});

// POST /api/rooms/:roomId/occupancy — set occupancy directly
apiRouter.post("/rooms/:roomId/occupancy", (req: Request, res: Response) => {
  const room = req.params.roomId as RoomId;
  if (!ROOM_IDS.includes(room)) {
    return res.status(400).json({ error: `room must be one of ${ROOM_IDS.join(", ")}` });
  }
  const { occupied } = req.body as { occupied: boolean };
  deviceStore.setOccupancy(room, Boolean(occupied));
  broadcastFullState(buildFullState());
  res.json({ room, occupied: Boolean(occupied) });
});

// GET /api/usage
apiRouter.get("/usage", (_req: Request, res: Response) => {
  res.json(computeUsageSnapshot());
});

// GET /api/usage/history?bucketMinutes=30
apiRouter.get("/usage/history", (req: Request, res: Response) => {
  const bucketMinutes = Number(req.query.bucketMinutes) || 30;
  res.json(computeUsageHistory(bucketMinutes));
});

// GET /api/efficiency
apiRouter.get("/efficiency", (_req: Request, res: Response) => {
  res.json(computeEfficiencyLeaderboard());
});

// GET /api/export/events.csv
apiRouter.get("/export/events.csv", (_req: Request, res: Response) => {
  const csv = exportTodayEventsCsv();
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=drishti-events-today.csv");
  res.send(csv);
});

// GET /api/alerts
apiRouter.get("/alerts", (_req: Request, res: Response) => {
  res.json(evaluateAlerts());
});

// POST /api/alerts/:id/ack
apiRouter.post("/alerts/:id/ack", (req: Request, res: Response) => {
  const ok = acknowledgeAlert(req.params.id);
  if (!ok) return res.status(404).json({ error: "alert not found" });
  io.emit("state:alerts", evaluateAlerts());
  broadcastFullState(buildFullState());
  res.json({ acknowledged: true });
});

// POST /api/alerts/ack-all — acknowledge every active alert
apiRouter.post("/alerts/ack-all", (_req: Request, res: Response) => {
  const alerts = evaluateAlerts();
  let count = 0;
  for (const a of alerts) {
    if (!a.acknowledged && acknowledgeAlert(a.id)) count++;
  }
  io.emit("state:alerts", evaluateAlerts());
  broadcastFullState(buildFullState());
  res.json({ acknowledged: count });
});

// GET /api/events?since=ISO
apiRouter.get("/events", (req: Request, res: Response) => {
  const since = (req.query.since as string) ?? new Date(0).toISOString();
  const limit = Number(req.query.limit) || 200;
  const events = deviceStore.getEventsSince(since);
  res.json(events.slice(-limit));
});

// GET /api/stats — comprehensive office stats for bot !stats command and dashboard
apiRouter.get("/stats", (_req: Request, res: Response) => {
  const devices = deviceStore.getAllDevices();
  const usage = computeUsageSnapshot();
  const alerts = evaluateAlerts();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const todayHistory = getAlertHistorySince(startOfDay.toISOString());
  const allEvents = deviceStore.getAllEvents();
  const todayEvents = deviceStore.getEventsSince(startOfDay.toISOString());

  const activeAlerts = alerts.filter((a) => !a.acknowledged);
  const topRoom = usage.perRoom.slice().sort((a, b) => b.totalWatts - a.totalWatts)[0];
  const flappingDevices = devices.filter((d) => d.isFlapping);

  const peakWatts = (() => {
    const history = computeUsageHistory(10);
    return Math.max(...history.map((p) => p.watts), 0);
  })();

  res.json({
    timestamp: new Date().toISOString(),
    summary: {
      totalDevices: devices.length,
      devicesOn: devices.filter((d) => d.isOn).length,
      devicesFlapping: flappingDevices.length,
      totalWatts: usage.totalWatts,
      peakWattsToday: peakWatts,
      kwhToday: usage.estimatedKwhToday,
      costToday: usage.estimatedCostBdt,
      co2Today: usage.estimatedCo2Kg,
      projectedKwh: usage.projectedKwhFullDay,
    },
    alerts: {
      active: activeAlerts.length,
      critical: activeAlerts.filter((a) => a.severity === "critical").length,
      warning: activeAlerts.filter((a) => a.severity === "warning").length,
      info: activeAlerts.filter((a) => a.severity === "info").length,
      raisedToday: todayHistory.length,
    },
    rooms: ROOM_IDS.map((room) => {
      const roomDevices = devices.filter((d) => d.room === room);
      const roomUsage = usage.perRoom.find((r) => r.room === room);
      const roomAlerts = activeAlerts.filter((a) => a.room === room);
      const roomEventsToday = todayEvents.filter((e) => e.room === room);
      return {
        room,
        devicesOn: roomUsage?.devicesOn ?? 0,
        devicesTotal: roomUsage?.devicesTotal ?? 0,
        watts: roomUsage?.totalWatts ?? 0,
        activeAlerts: roomAlerts.length,
        eventsToday: roomEventsToday.length,
      };
    }),
    topConsumerRoom: topRoom?.room ?? null,
    flappingDevices: flappingDevices.map((d) => ({ id: d.id, label: d.label, room: d.room })),
    virtualClock: {
      hour: deviceStore.getVirtualHour(),
      isOverridden: deviceStore.isHourOverridden(),
    },
  });
});

// GET /api/suggestions — contextual energy-saving suggestions
apiRouter.get("/suggestions", (_req: Request, res: Response) => {
  res.json(generateSuggestions());
});

// ── Admin / demo-control endpoints ──────────────────────────────────────────

apiRouter.post("/admin/override-time", (req: Request, res: Response) => {
  const hour = Number(req.body?.hour);
  if (Number.isNaN(hour) || hour < 0 || hour > 23) {
    return res.status(400).json({ error: "hour must be 0-23" });
  }
  deviceStore.overrideHour(hour);
  broadcastFullState(buildFullState());
  res.json({ virtualHour: hour });
});

apiRouter.post("/admin/reset-time", (_req: Request, res: Response) => {
  deviceStore.clearHourOverride();
  broadcastFullState(buildFullState());
  res.json({ ok: true });
});

apiRouter.post("/admin/simulate-anomaly", (req: Request, res: Response) => {
  const room = req.body?.room as RoomId;
  const hoursAgo = Number(req.body?.hoursAgo ?? 3);
  if (!ROOM_IDS.includes(room)) {
    return res.status(400).json({ error: `room must be one of ${ROOM_IDS.join(", ")}` });
  }
  const affected = deviceStore.forceAnomaly(room, hoursAgo);
  broadcastFullState(buildFullState());
  res.json({ affected: affected.length, room });
});

// POST /admin/shutdown-all — turn off devices (emergency)
// Body (optional): { kind?: "fan" | "light", room?: RoomId }
apiRouter.post("/admin/shutdown-all", (req: Request, res: Response) => {
  const { kind, room } = (req.body ?? {}) as { kind?: "fan" | "light"; room?: RoomId };
  let devices = deviceStore.getAllDevices().filter((d) => d.isOn);
  if (kind === "fan" || kind === "light") devices = devices.filter((d) => d.kind === kind);
  if (room && ROOM_IDS.includes(room as RoomId)) devices = devices.filter((d) => d.room === room);
  devices.forEach((d) => deviceStore.setDeviceState(d.id, false));
  broadcastFullState(buildFullState());
  res.json({ shutDown: devices.length, kind: kind ?? "all", room: room ?? "all" });
});

// ── IoT / ESP32 endpoints ────────────────────────────────────────────────────

interface IotSensorPayload {
  deviceId?: string;
  temperature?: number;
  humidity?: number;
  occupancy?: [boolean, boolean, boolean]; // [drawing_room, work_room_1, work_room_2]
  relays?: [boolean, boolean, boolean];
  mode?: string;
}

let latestIotReading: IotSensorPayload & { receivedAt: string } | null = null;

/**
 * POST /api/iot/sensor
 * Receives real-time sensor data from the ESP32 hardware node.
 * Updates occupancy in deviceStore so the dashboard reflects physical state.
 * Returns active alert count so the ESP32 can light the alarm LED.
 */
apiRouter.post("/iot/sensor", (req: Request, res: Response) => {
  const body = req.body as IotSensorPayload;

  // Persist latest reading (accessible via GET /api/iot/sensor)
  latestIotReading = { ...body, receivedAt: new Date().toISOString() };

  // Sync occupancy from PIR readings into deviceStore
  if (Array.isArray(body.occupancy) && body.occupancy.length === 3) {
    const rooms: RoomId[] = ["drawing_room", "work_room_1", "work_room_2"];
    rooms.forEach((room, i) => {
      deviceStore.setOccupancy(room, Boolean(body.occupancy![i]));
    });
    broadcastFullState(buildFullState());
  }

  const activeAlerts = evaluateAlerts().filter((a) => !a.acknowledged).length;
  res.json({ ok: true, activeAlerts });
});

/**
 * GET /api/iot/sensor
 * Returns the latest sensor reading pushed by the ESP32.
 */
apiRouter.get("/iot/sensor", (_req: Request, res: Response) => {
  if (!latestIotReading) return res.status(204).json({ message: "No data yet" });
  res.json(latestIotReading);
});

/**
 * GET /api/iot/relays?deviceId=xxx
 * Returns the desired relay states derived from current device store state.
 * ESP32 polls this to know what the backend wants the physical relays to do.
 */
apiRouter.get("/iot/relays", (_req: Request, res: Response) => {
  const rooms: RoomId[] = ["drawing_room", "work_room_1", "work_room_2"];
  const relays = rooms.map((room) => {
    const roomDevices = deviceStore.getAllDevices().filter((d) => d.room === room);
    // Relay is on if ANY device in the room is on
    return roomDevices.some((d) => d.isOn);
  });

  const activeAlerts = evaluateAlerts().filter((a) => !a.acknowledged).length;
  res.json({ relays, activeAlerts });
});
