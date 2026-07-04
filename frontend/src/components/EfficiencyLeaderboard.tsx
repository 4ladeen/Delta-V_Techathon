import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { RoomEfficiency, EfficiencyGrade } from "@drishti/shared";

const GRADE_CONFIG: Record<EfficiencyGrade, { cls: string; glow: string; label: string }> = {
  A: { cls: "grade-A", glow: "shadow-pulseGlow", label: "Excellent" },
  B: { cls: "grade-B", glow: "shadow-[0_0_12px_rgba(34,197,94,0.3)]", label: "Good" },
  C: { cls: "grade-C", glow: "shadow-[0_0_12px_rgba(217,119,6,0.3)]", label: "Fair" },
  D: { cls: "grade-D", glow: "shadow-[0_0_12px_rgba(249,115,22,0.3)]", label: "Poor" },
  F: { cls: "grade-F", glow: "shadow-alarmGlow", label: "Critical" },
};

const RANK_ICONS = ["🥇", "🥈", "🥉"];

export default function EfficiencyLeaderboard() {
  const [board, setBoard] = useState<RoomEfficiency[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const prevScores = useRef<Record<string, number>>({});

  useEffect(() => {
    const load = () => {
      fetch("/api/efficiency")
        .then((r) => r.json())
        .then((data: RoomEfficiency[]) => {
          setBoard(data);
          // Animate score bar changes
          data.forEach((entry) => {
            const prev = prevScores.current[entry.room] ?? entry.score;
            if (prev !== entry.score) {
              const el = document.querySelector(`[data-score-bar="${entry.room}"]`);
              if (el) {
                gsap.to(el, { width: `${entry.score}%`, duration: 0.8, ease: "power2.out" });
              }
            }
            prevScores.current[entry.room] = entry.score;
          });
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!ref.current || board.length === 0) return;
    const ctx = gsap.context(() => {
      gsap.from(".lb-row", {
        x: -16,
        opacity: 0,
        duration: 0.4,
        stagger: 0.08,
        ease: "power3.out",
      });
    }, ref);
    return () => ctx.revert();
  }, [board.length > 0]);

  const scoreBarColor = (grade: EfficiencyGrade) => {
    const map = { A: "#0D9488", B: "#16A34A", C: "#D97706", D: "#EA580C", F: "#DC2626" };
    return map[grade];
  };

  return (
    <div ref={ref} className="panel-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-fog">Room Efficiency</h3>
        <span className="text-[10px] font-mono text-mist uppercase tracking-wider">Today's score</span>
      </div>

      <div className="flex flex-col gap-3">
        {board.map((entry, idx) => {
          const cfg = GRADE_CONFIG[entry.grade];
          return (
            <div key={entry.room} className="lb-row flex flex-col gap-1.5 p-3 rounded-xl bg-void/40 border border-line hover:border-line/80 transition-colors">
              <div className="flex items-center gap-2.5">
                <span className="text-base leading-none w-5">{RANK_ICONS[idx] ?? `#${idx + 1}`}</span>
                <span className="text-sm font-medium text-fog flex-1">{entry.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-mist">{entry.incidentsToday} inc.</span>
                  <div
                    className={`w-8 h-8 rounded-lg border flex items-center justify-center font-display font-bold text-sm ${cfg.cls} ${cfg.glow}`}
                    title={cfg.label}
                  >
                    {entry.grade}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-void rounded-full overflow-hidden">
                  <div
                    data-score-bar={entry.room}
                    className="h-full rounded-full transition-none"
                    style={{
                      width: `${entry.score}%`,
                      backgroundColor: scoreBarColor(entry.grade),
                    }}
                  />
                </div>
                <span className="text-[10px] font-mono text-mist w-8 text-right">{entry.score}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
