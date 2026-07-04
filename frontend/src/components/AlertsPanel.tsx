import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Alert, AlertSeverity } from "@drishti/shared";

interface Props {
  alerts: Alert[];
  onAck: (id: string) => void;
}

const SEVERITY_CONFIG: Record<AlertSeverity, { dot: string; border: string; bg: string; label: string; icon: string }> = {
  critical: { dot: "bg-alarm", border: "border-l-alarm", bg: "bg-alarm/5", label: "CRITICAL", icon: "🔥" },
  warning:  { dot: "bg-caution", border: "border-l-caution", bg: "bg-caution/5", label: "WARNING", icon: "⚠️" },
  info:     { dot: "bg-pulse", border: "border-l-pulse", bg: "bg-pulse/5", label: "INFO", icon: "ℹ️" },
};

const ALERT_TYPE_LABEL: Record<string, string> = {
  after_hours: "After Hours",
  continuous_run: "Continuous Run",
  phantom_load: "Phantom Load",
  occupancy_mismatch: "No Occupancy",
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function AlertItem({ alert, onAck }: { alert: Alert; onAck: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cfg = SEVERITY_CONFIG[alert.severity];
  const [, tick] = useState(0);

  // Live-update timeAgo every 10s
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      gsap.from(el, {
        x: -16,
        opacity: 0,
        duration: 0.4,
        ease: "power3.out",
      });
    });
    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={ref}
      className={`border-l-4 rounded-r-xl px-3 py-2.5 flex flex-col gap-1.5 ${cfg.border} ${cfg.bg}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">{cfg.icon}</span>
          <span className={`badge text-[9px] ${cfg.dot === "bg-alarm" ? "text-alarm border-alarm/30 bg-alarm/10" : cfg.dot === "bg-caution" ? "text-caution border-caution/30 bg-caution/10" : "text-pulse border-pulse/30 bg-pulse/10"}`}>
            {cfg.label}
          </span>
          <span className="text-[10px] font-mono text-mist">{ALERT_TYPE_LABEL[alert.type] ?? alert.type}</span>
        </div>
        <button
          onClick={onAck}
          className="text-[10px] font-mono text-mist hover:text-fog transition-colors shrink-0 underline-offset-2 hover:underline"
          title="Acknowledge"
        >
          ack
        </button>
      </div>
      <p className="text-xs text-fog leading-relaxed">{alert.message}</p>
      <span className="text-[10px] font-mono text-mist/60">{timeAgo(alert.createdAt)}</span>
    </div>
  );
}

export default function AlertsPanel({ alerts, onAck }: Props) {
  const active = alerts.filter((a) => !a.acknowledged);
  const critCount = active.filter((a) => a.severity === "critical").length;
  const warnCount = active.filter((a) => a.severity === "warning").length;

  async function ackAll() {
    await fetch("/api/alerts/ack-all", { method: "POST" });
  }

  return (
    <div className="panel-card p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-display font-semibold text-fog">Active Alerts</h3>
        <div className="flex items-center gap-1.5">
          {critCount > 0 && (
            <span className="badge text-alarm border-alarm/30 bg-alarm/10">{critCount} crit</span>
          )}
          {warnCount > 0 && (
            <span className="badge text-caution border-caution/30 bg-caution/10">{warnCount} warn</span>
          )}
          {active.length === 0 && (
            <span className="badge text-pulse border-pulse/30 bg-pulse/10">clear</span>
          )}
          {active.length >= 2 && (
            <button onClick={ackAll} className="btn-ghost text-[10px] py-0.5 px-2">
              Ack All
            </button>
          )}
        </div>
      </div>

      {active.length === 0 ? (
        <div className="py-8 flex flex-col items-center gap-2 text-center">
          <div className="w-10 h-10 rounded-full border border-pulse/20 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0D9488" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <p className="text-xs font-mono text-mist">All clear — office behaving normally</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2 overflow-y-auto max-h-72 pr-0.5">
          {active
            .sort((a, b) => {
              const order = { critical: 0, warning: 1, info: 2 };
              return order[a.severity] - order[b.severity];
            })
            .map((alert) => (
              <AlertItem key={alert.id} alert={alert} onAck={() => onAck(alert.id)} />
            ))}
        </div>
      )}
    </div>
  );
}
