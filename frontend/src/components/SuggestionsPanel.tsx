import { useEffect, useRef, useState } from "react";
import gsap from "gsap";

interface Suggestion {
  id: string;
  priority: "high" | "medium" | "low";
  action: string;
  reason: string;
  estimatedSavingWatts: number;
  rooms: string[];
}

const PRIORITY_CONFIG = {
  high:   { cls: "text-alarm border-alarm/30 bg-alarm/10",   icon: "🔴", label: "High" },
  medium: { cls: "text-caution border-caution/30 bg-caution/10", icon: "🟡", label: "Medium" },
  low:    { cls: "text-pulse border-pulse/30 bg-pulse/10",   icon: "🟢", label: "Low" },
};

export default function SuggestionsPanel() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      fetch("/api/suggestions")
        .then((r) => r.json())
        .then(setSuggestions)
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!ref.current || suggestions.length === 0) return;
    const ctx = gsap.context(() => {
      gsap.from(".suggestion-row", {
        y: 10,
        opacity: 0,
        duration: 0.4,
        stagger: 0.08,
        ease: "power2.out",
      });
    }, ref);
    return () => ctx.revert();
  }, [suggestions.length]);

  return (
    <div ref={ref} className="panel-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-fog">Smart Suggestions</h3>
        <span className="text-[10px] font-mono text-mist uppercase tracking-wider">
          {suggestions.length} tip{suggestions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {suggestions.length === 0 ? (
        <div className="py-6 flex flex-col items-center gap-2 text-center">
          <span className="text-2xl">✨</span>
          <p className="text-xs font-mono text-mist">Energy usage looks optimal right now</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {suggestions.map((s) => {
            const cfg = PRIORITY_CONFIG[s.priority];
            return (
              <div
                key={s.id}
                className="suggestion-row p-3 rounded-xl bg-void/40 border border-line flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`badge text-[9px] ${cfg.cls}`}>
                    {cfg.icon} {cfg.label}
                  </span>
                  <span className="text-[10px] font-mono text-mist">
                    −{s.estimatedSavingWatts}W potential
                  </span>
                </div>
                <p className="text-xs font-medium text-fog">{s.action}</p>
                <p className="text-[10px] font-mono text-mist/70 leading-relaxed">{s.reason}</p>
                {s.rooms.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {s.rooms.map((r) => (
                      <span key={r} className="badge text-[9px] text-mist border-line bg-void">
                        {r}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
