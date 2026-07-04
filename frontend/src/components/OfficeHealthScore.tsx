import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { OfficeState } from "@drishti/shared";

interface Props { state: OfficeState; }

function computeHealthScore(state: OfficeState): { score: number; label: string; color: string } {
  let score = 100;
  const hour = state.virtualClock.hour;
  const isOffHours = hour < 9 || hour >= 17;
  const activeAlerts = state.alerts.filter((a) => !a.acknowledged);

  // Deduct for after-hours devices
  if (isOffHours) {
    const onCount = state.devices.filter((d) => d.isOn).length;
    score -= onCount * 4;
  }

  // Deduct for active alerts
  for (const alert of activeAlerts) {
    if (alert.severity === "critical") score -= 15;
    else if (alert.severity === "warning") score -= 7;
    else score -= 3;
  }

  // Deduct for flapping devices
  const flapping = state.devices.filter((d) => d.isFlapping).length;
  score -= flapping * 6;

  // Deduct based on total load vs expected
  const maxExpected = state.devices.reduce((s, d) => s + d.wattage, 0);
  const loadRatio = state.usage.totalWatts / maxExpected;
  if (isOffHours && loadRatio > 0.2) score -= Math.round((loadRatio - 0.2) * 20);

  const clamped = Math.max(0, Math.min(100, score));

  if (clamped >= 85) return { score: clamped, label: "Excellent", color: "#0D9488" };
  if (clamped >= 70) return { score: clamped, label: "Good", color: "#16A34A" };
  if (clamped >= 50) return { score: clamped, label: "Fair", color: "#D97706" };
  if (clamped >= 30) return { score: clamped, label: "Poor", color: "#EA580C" };
  return { score: clamped, label: "Critical", color: "#DC2626" };
}

export default function OfficeHealthScore({ state }: Props) {
  const { score, label, color } = computeHealthScore(state);
  const numRef = useRef<HTMLSpanElement>(null);
  const arcRef = useRef<SVGCircleElement>(null);
  const prevScore = useRef(score);

  const R = 40;
  const CIRCUMFERENCE = 2 * Math.PI * R;

  useEffect(() => {
    const prev = prevScore.current;
    const obj = { v: prev };

    if (numRef.current) {
      gsap.to(obj, {
        v: score,
        duration: 1.2,
        ease: "power2.out",
        onUpdate: () => {
          if (numRef.current) numRef.current.textContent = Math.round(obj.v).toString();
        },
      });
    }

    if (arcRef.current) {
      const targetDash = CIRCUMFERENCE * (1 - score / 100);
      gsap.to(arcRef.current, {
        attr: { "stroke-dashoffset": targetDash },
        duration: 1.2,
        ease: "power2.out",
      });
    }

    prevScore.current = score;
  }, [score]);

  const dashOffset = CIRCUMFERENCE * (1 - score / 100);

  return (
    <div className="panel-card p-5 flex flex-col items-center gap-3">
      <div className="flex items-center justify-between w-full">
        <h3 className="font-display font-semibold text-fog">Office Health</h3>
        <span className="text-[10px] font-mono text-mist uppercase tracking-wider">live score</span>
      </div>

      <div className="relative flex items-center justify-center">
        <svg width="110" height="110" viewBox="0 0 110 110" className="-rotate-90">
          {/* Background track */}
          <circle
            cx="55" cy="55" r={R}
            fill="none"
            stroke="#CBD5E1"
            strokeWidth="8"
            strokeLinecap="round"
          />
          {/* Score arc */}
          <circle
            ref={arcRef}
            cx="55" cy="55" r={R}
            fill="none"
            stroke={color}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke 0.6s ease", filter: `drop-shadow(0 0 6px ${color}66)` }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="font-display font-bold text-2xl leading-none" style={{ color }}>
            <span ref={numRef}>{score}</span>
          </span>
          <span className="text-[10px] font-mono text-mist mt-0.5">/ 100</span>
        </div>
      </div>

      <div
        className="text-sm font-display font-semibold"
        style={{ color }}
      >
        {label}
      </div>

      <div className="w-full flex flex-col gap-1.5 text-[10px] font-mono text-mist border-t border-line pt-3">
        <div className="flex justify-between">
          <span>Active alerts</span>
          <span className={state.alerts.filter((a) => !a.acknowledged).length > 0 ? "text-alarm" : "text-pulse"}>
            {state.alerts.filter((a) => !a.acknowledged).length}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Flapping devices</span>
          <span className={state.devices.filter((d) => d.isFlapping).length > 0 ? "text-caution" : "text-pulse"}>
            {state.devices.filter((d) => d.isFlapping).length}
          </span>
        </div>
        <div className="flex justify-between">
          <span>Devices on</span>
          <span className="text-fog">{state.devices.filter((d) => d.isOn).length}/{state.devices.length}</span>
        </div>
      </div>
    </div>
  );
}
