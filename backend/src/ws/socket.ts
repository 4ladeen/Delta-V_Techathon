import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import {
  ServerToClientEvents,
  ClientToServerEvents,
  OfficeState,
  Device,
  UsageSnapshot,
  Alert,
} from "@drishti/shared";
import { deviceStore } from "../simulator/store";
import { evaluateAlerts } from "../services/alertEngine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let io: Server<ClientToServerEvents, ServerToClientEvents>;

export function initSocket(httpServer: HttpServer): void {
  io = new Server(httpServer, {
    cors: { origin: "*" }, // demo-appropriate; tighten if deploying publicly long-term
  });

  io.on("connection", (socket: Socket) => {
    console.log(`[ws] client connected: ${socket.id}`);

    socket.on("device:toggle", (deviceId: string) => {
      const updated = deviceStore.toggleDevice(deviceId);
      if (updated) {
        broadcastDevices();
        io.emit("state:alerts", evaluateAlerts());
      }
    });

    socket.on("disconnect", () => {
      console.log(`[ws] client disconnected: ${socket.id}`);
    });
  });
}

export function broadcastFullState(state: OfficeState): void {
  io.emit("state:full", state);
}

export function broadcastDevices(): void {
  const devices: Device[] = deviceStore.getAllDevices();
  io.emit("state:devices", devices);
}

export function broadcastUsage(usage: UsageSnapshot): void {
  io.emit("state:usage", usage);
}

export function broadcastNewAlert(alert: Alert): void {
  io.emit("alert:new", alert);
}
