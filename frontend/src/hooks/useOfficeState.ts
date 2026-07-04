import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import {
  OfficeState,
  ServerToClientEvents,
  ClientToServerEvents,
  Alert,
} from "@drishti/shared";

/**
 * Single hook owning the live connection to the backend. The dashboard's
 * "no manual refresh" requirement is satisfied entirely here: state
 * arrives via WebSocket push, never polling.
 */
export function useOfficeState() {
  const [state, setState] = useState<OfficeState | null>(null);
  const [connected, setConnected] = useState(false);
  const [recentAlert, setRecentAlert] = useState<Alert | null>(null);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);

  useEffect(() => {
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io("/", {
      path: "/socket.io",
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("state:full", (full) => setState(full));
    socket.on("state:devices", (devices) =>
      setState((prev) => (prev ? { ...prev, devices } : prev))
    );
    socket.on("state:usage", (usage) =>
      setState((prev) => (prev ? { ...prev, usage } : prev))
    );
    socket.on("state:alerts", (alerts) =>
      setState((prev) => (prev ? { ...prev, alerts } : prev))
    );
    socket.on("alert:new", (alert) => {
      setRecentAlert(alert);
      setTimeout(() => setRecentAlert((cur) => (cur?.id === alert.id ? null : cur)), 6000);
    });

    // Initial fetch in case the socket connects slower than first paint.
    fetch("/api/state")
      .then((r) => r.json())
      .then(setState)
      .catch(() => {});

    return () => {
      socket.disconnect();
    };
  }, []);

  const toggleDevice = useCallback((deviceId: string) => {
    socketRef.current?.emit("device:toggle", deviceId);
  }, []);

  return { state, connected, recentAlert, toggleDevice };
}
