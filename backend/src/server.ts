import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, "../.env") });

import express from "express";
import cors from "cors";
import { createServer } from "http";
import { apiRouter, buildFullState } from "./routes/api";
import { initSocket, broadcastFullState, broadcastNewAlert } from "./ws/socket";
import { startSimulatorLoop, seedHistory } from "./simulator/mutator";
import { evaluateAlerts } from "./services/alertEngine";
import { Alert } from "@drishti/shared";

const app = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());
app.use("/api", apiRouter);

// Serve the built frontend as static files so the whole system runs
// from a single process/port for judges — no CORS juggling at demo time.
const frontendDist = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.join(frontendDist, "index.html"));
});

initSocket(httpServer);
seedHistory();

let knownAlertIds = new Set<string>();

/** Called by the simulator every tick to push fresh state and detect new alerts. */
function onSimulatorTick(): void {
  const alerts = evaluateAlerts();
  const newAlerts: Alert[] = alerts.filter((a) => !knownAlertIds.has(a.id));
  knownAlertIds = new Set(alerts.map((a) => a.id));

  broadcastFullState(buildFullState());
  for (const alert of newAlerts) {
    broadcastNewAlert(alert);
    onNewAlertHook?.(alert);
  }
}

/** Optional external hook (wired by the Discord bot process if co-located). */
export let onNewAlertHook: ((alert: Alert) => void) | null = null;
export function setOnNewAlertHook(fn: (alert: Alert) => void): void {
  onNewAlertHook = fn;
}

import { fork } from "child_process";

startSimulatorLoop(onSimulatorTick, Number(process.env.SIMULATOR_INTERVAL_MS) || 8000);

const PORT = Number(process.env.PORT) || 8000;
httpServer.listen(PORT, () => {
  console.log(`\n  Drishti backend running → http://localhost:${PORT}`);
  console.log(`  Dashboard served from the same origin — open it in a browser.\n`);

  // Spawns bot in production mode to fulfill single-process deployment (`npm start`)
  const isProduction = __dirname.includes("dist");
  if (isProduction && process.env.DISCORD_BOT_TOKEN) {
    const botPath = path.join(__dirname, "../../bot/dist/index.js");
    console.log(`  [server] DISCORD_BOT_TOKEN found. Spawning bot process at ${botPath}...`);
    const botProcess = fork(botPath, [], {
      env: { ...process.env },
    });
    botProcess.on("error", (err) => {
      console.error("  [server] Failed to spawn bot process:", err);
    });
    botProcess.on("exit", (code) => {
      console.log(`  [server] Bot process exited with code ${code}`);
    });
  }
});

