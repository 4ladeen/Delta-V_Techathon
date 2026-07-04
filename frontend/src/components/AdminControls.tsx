import { useRef, useState } from "react";
import gsap from "gsap";
import { RoomId, ROOM_IDS, ROOM_LABELS } from "@drishti/shared";

export default function AdminControls() {
  const [hour, setHour] = useState(14);
  const [room, setRoom] = useState<RoomId>("work_room_2");
  const [busy, setBusy] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  function showFeedback(msg: string) {
    setLastAction(msg);
    if (feedbackRef.current) {
      gsap.fromTo(
        feedbackRef.current,
        { opacity: 0, y: 4 },
        { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }
      );
      gsap.to(feedbackRef.current, { opacity: 0, duration: 0.4, delay: 2.5 });
    }
  }

  async function overrideTime() {
    setBusy(true);
    await fetch("/api/admin/override-time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hour }),
    });
    setBusy(false);
    showFeedback(`Virtual clock → ${String(hour).padStart(2, "0")}:00`);
  }

  async function resetTime() {
    setBusy(true);
    await fetch("/api/admin/reset-time", { method: "POST" });
    setBusy(false);
    showFeedback("Reverted to real time");
  }

  async function forceAnomaly() {
    setBusy(true);
    await fetch("/api/admin/simulate-anomaly", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room, hoursAgo: 3 }),
    });
    setBusy(false);
    showFeedback(`3h anomaly triggered in ${ROOM_LABELS[room]}`);
  }

  const hourLabel = String(hour).padStart(2, "0");
  const isOffHours = hour < 9 || hour >= 17;

  return (
    <div className="panel-card p-5 border-dashed border-line/60">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-fog">Demo Controls</h3>
        <span className="badge border-caution/30 text-caution bg-caution/5">judging tool</span>
      </div>

      <p className="text-[10px] font-mono text-mist/70 mb-4 leading-relaxed">
        Deterministically trigger any alert type on demand — so live demos don't depend on lucky timing.
        Documented in README as an intentional feature.
      </p>

      {/* Time override */}
      <div className="flex flex-col gap-3 mb-4 pb-4 border-b border-line">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-mist">Virtual Clock</span>
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-mono font-semibold ${isOffHours ? "text-caution" : "text-pulse"}`}>
              {hourLabel}:00
            </span>
            {isOffHours && (
              <span className="badge text-caution border-caution/30 bg-caution/10 text-[9px]">after-hours</span>
            )}
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={23}
          value={hour}
          onChange={(e) => setHour(Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${isOffHours ? "#EA580C" : "#0D9488"} ${(hour / 23) * 100}%, #CBD5E1 ${(hour / 23) * 100}%)`,
          }}
        />
        <div className="flex justify-between text-[9px] font-mono text-mist/50">
          <span>12am</span>
          <span className="text-pulse/60">9am</span>
          <span className="text-pulse/60">5pm</span>
          <span>11pm</span>
        </div>
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={overrideTime}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            Apply {hourLabel}:00
          </button>
          <button
            disabled={busy}
            onClick={resetTime}
            className="btn-ghost disabled:opacity-40"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Force anomaly */}
      <div className="flex flex-col gap-3 mb-4 pb-4 border-b border-line">
        <span className="text-xs font-mono text-mist">Force 3h Continuous-Run</span>
        <select
          value={room}
          onChange={(e) => setRoom(e.target.value as RoomId)}
          className="text-xs font-mono bg-void border border-line rounded-lg px-3 py-2 text-fog appearance-none cursor-pointer hover:border-line/80 transition-colors"
        >
          {ROOM_IDS.map((r) => (
            <option key={r} value={r}>{ROOM_LABELS[r]}</option>
          ))}
        </select>
        <button
          disabled={busy}
          onClick={forceAnomaly}
          className="btn-danger disabled:opacity-40"
        >
          🔥 Trigger Continuous-Run Alert
        </button>
      </div>

      {/* Granular device control */}
      <div className="flex flex-col gap-3 mb-4 pb-4 border-b border-line">
        <span className="text-xs font-mono text-mist">Room Controls</span>
        {ROOM_IDS.map((r) => (
          <div key={r} className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-mist/70 w-24 truncate">{ROOM_LABELS[r]}</span>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await fetch(`/api/rooms/${r}/toggle`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ state: true }),
                });
                setBusy(false);
                showFeedback(`${ROOM_LABELS[r]} — all on`);
              }}
              className="btn-ghost text-[10px] py-0.5 px-2 disabled:opacity-40"
            >
              🟢 All On
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await fetch(`/api/rooms/${r}/toggle`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ state: false }),
                });
                setBusy(false);
                showFeedback(`${ROOM_LABELS[r]} — all off`);
              }}
              className="btn-ghost text-[10px] py-0.5 px-2 disabled:opacity-40"
            >
              ⚫ All Off
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await fetch(`/api/rooms/${r}/toggle`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ state: false, kind: "fan" }),
                });
                setBusy(false);
                showFeedback(`${ROOM_LABELS[r]} — fans off`);
              }}
              className="btn-ghost text-[10px] py-0.5 px-2 disabled:opacity-40"
            >
              🌀 Fans Off
            </button>
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await fetch(`/api/rooms/${r}/toggle`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ state: false, kind: "light" }),
                });
                setBusy(false);
                showFeedback(`${ROOM_LABELS[r]} — lights off`);
              }}
              className="btn-ghost text-[10px] py-0.5 px-2 disabled:opacity-40"
            >
              💡 Lights Off
            </button>
          </div>
        ))}
      </div>

      {/* Building-wide quick actions */}
      <div className="flex flex-col gap-3">
        <span className="text-xs font-mono text-mist">Building-Wide</span>
        <div className="grid grid-cols-2 gap-2">
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await fetch("/api/admin/shutdown-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
              setBusy(false);
              showFeedback("All devices shut down");
            }}
            className="btn-danger disabled:opacity-40"
          >
            🔌 All Off
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await fetch("/api/admin/shutdown-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "fan" }) });
              setBusy(false);
              showFeedback("All fans shut down");
            }}
            className="btn-danger disabled:opacity-40"
          >
            🌀 All Fans Off
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await fetch("/api/admin/shutdown-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "light" }) });
              setBusy(false);
              showFeedback("All lights shut down");
            }}
            className="btn-danger disabled:opacity-40"
          >
            💡 All Lights Off
          </button>
          <a
            href="/api/export/events.csv"
            download
            className="btn-ghost text-center"
          >
            📄 Export CSV
          </a>
        </div>
      </div>

      {/* Feedback */}
      <div ref={feedbackRef} className="mt-3 text-[10px] font-mono text-pulse opacity-0">
        ✓ {lastAction}
      </div>
    </div>
  );
}
