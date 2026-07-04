import { useEffect, useRef } from "react";
import gsap from "gsap";
import { UsageSnapshot } from "@drishti/shared";

interface Props { usage: UsageSnapshot; }

interface StatCardProps {
  label: string;
  value: number;
  unit: string;
  decimals?: number;
  accent: string;
  icon: React.ReactNode;
  sub?: string;
}

function StatCard({ label, value, unit, decimals = 0, accent, icon, sub }: StatCardProps) {
  const numRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef<number>(value);

  useEffect(() => {
    if (!numRef.current) return;
    const prev = prevRef.current;
    const obj = { v: prev };
    const tween = gsap.to(obj, {
      v: value,
      duration: 0.9,
      ease: "power2.out",
      onUpdate: () => {
        if (numRef.current) {
          numRef.current.textContent = decimals > 0 ? obj.v.toFixed(decimals) : Math.round(obj.v).toString();
        }
      },
    });
    prevRef.current = value;
    return () => { tween.kill(); };
  }, [value, decimals]);

  return (
    <div className="panel-card p-4 flex flex-col gap-3 group hover:shadow-cardHover transition-shadow duration-300">
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-mono uppercase tracking-wider text-mist">{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent.replace("text-", "bg-").replace(/text-\S+/, "")} bg-opacity-10`}
          style={{ background: accent.includes("pulse") ? "rgba(13,148,136,0.12)" : accent.includes("signal") ? "rgba(217,119,6,0.12)" : accent.includes("alarm") ? "rgba(220,38,38,0.12)" : "rgba(99,102,241,0.12)" }}
        >
          <span className={accent}>{icon}</span>
        </div>
      </div>
      <div className="flex items-end gap-1.5">
        <span className={`stat-value text-2xl leading-none ${accent}`}>
          <span ref={numRef}>{decimals > 0 ? value.toFixed(decimals) : Math.round(value)}</span>
        </span>
        <span className="text-xs font-mono text-mist mb-0.5">{unit}</span>
      </div>
      {sub && <p className="text-[10px] font-mono text-mist/70 leading-relaxed">{sub}</p>}
    </div>
  );
}

export default function UsagePanel({ usage }: Props) {
  const maxRoomWatts = Math.max(...usage.perRoom.map((r) => r.totalWatts), 1);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!barRef.current) return;
    const bars = barRef.current.querySelectorAll(".room-bar-fill");
    bars.forEach((bar, i) => {
      const target = usage.perRoom[i]?.totalWatts ?? 0;
      const pct = (target / maxRoomWatts) * 100;
      gsap.to(bar, { width: `${pct}%`, duration: 0.8, ease: "power2.out", delay: i * 0.06 });
    });
  }, [usage]);

  return (
    <div className="panel-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display font-semibold text-fog text-base">Energy Overview</h2>
        <span className="badge border border-pulse/30 text-pulse bg-pulse/10">
          <span className="w-1.5 h-1.5 rounded-full bg-pulse animate-pulse inline-block" />
          Live
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Live Load"
          value={usage.totalWatts}
          unit="W"
          accent="text-pulse"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>}
          sub="Current draw"
        />
        <StatCard
          label="Today (kWh)"
          value={usage.estimatedKwhToday}
          unit="kWh"
          decimals={3}
          accent="text-highlight"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
          sub={`Proj. ${usage.projectedKwhFullDay.toFixed(2)} kWh/day`}
        />
        <StatCard
          label="Est. Cost"
          value={usage.estimatedCostBdt}
          unit="৳"
          decimals={2}
          accent="text-signal"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>}
          sub="BPDB tiered rate"
        />
        <StatCard
          label="CO₂ Emitted"
          value={usage.estimatedCo2Kg}
          unit="kg"
          decimals={3}
          accent="text-caution"
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/></svg>}
          sub="0.63 kg/kWh BD grid"
        />
      </div>

      <div ref={barRef} className="flex flex-col gap-2">
        {usage.perRoom.map((room) => (
          <div key={room.room} className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-mist w-24 shrink-0 truncate">{room.label}</span>
            <div className="flex-1 h-1.5 bg-void rounded-full overflow-hidden">
              <div
                className="room-bar-fill h-full rounded-full bg-gradient-to-r from-pulse to-highlight transition-none"
                style={{ width: "0%" }}
              />
            </div>
            <div className="flex items-center gap-2 w-24 justify-end">
              <span className="text-[10px] font-mono text-mist">{room.devicesOn}/{room.devicesTotal}</span>
              <span className="text-xs font-mono text-fog tabular-nums">{room.totalWatts}W</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
