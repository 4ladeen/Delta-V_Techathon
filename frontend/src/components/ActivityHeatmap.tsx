import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { DeviceEvent, ROOM_IDS, ROOM_LABELS } from "@drishti/shared";

const HOUR_LABELS: Record<number, string> = {
  0: "12am", 3: "3am", 6: "6am", 9: "9am", 12: "12pm", 15: "3pm", 18: "6pm", 21: "9pm",
};

function HeatCell({
  count,
  max,
  hour,
  room,
}: {
  count: number;
  max: number;
  hour: number;
  room: string;
}) {
  const isOffHours = hour < 9 || hour >= 17;
  const intensity = count === 0 ? 0 : 0.2 + (count / max) * 0.8;

  return (
    <div
      title={`${ROOM_LABELS[room as keyof typeof ROOM_LABELS]} · ${hour}:00 — ${count} event${count !== 1 ? "s" : ""}`}
      className="flex-1 aspect-square rounded-sm transition-all duration-500 relative"
      style={{
        backgroundColor:
          count === 0
            ? isOffHours
              ? "rgba(203,213,225,0.25)"
              : "rgba(203,213,225,0.4)"
            : `rgba(13, 148, 136, ${intensity})`,
        outline: isOffHours && count > 0 ? "1px solid rgba(249,115,22,0.5)" : "none",
      }}
    />
  );
}

export default function ActivityHeatmap() {
  const [events, setEvents] = useState<DeviceEvent[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      fetch(`/api/events?since=${since.toISOString()}`)
        .then((r) => r.json())
        .then(setEvents)
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".heatmap-row", {
        x: -12,
        opacity: 0,
        duration: 0.4,
        stagger: 0.08,
        ease: "power2.out",
      });
    }, ref);
    return () => ctx.revert();
  }, [events.length > 0]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const grid = ROOM_IDS.map((room) => {
    const counts = hours.map((h) =>
      events.filter((e) => e.room === room && new Date(e.timestamp).getHours() === h).length
    );
    return { room, counts };
  });
  const max = Math.max(...grid.flatMap((r) => r.counts), 1);
  const totalEvents = events.length;
  const peakHour = hours.reduce((best, h) => {
    const total = grid.reduce((s, r) => s + r.counts[h], 0);
    const bestTotal = grid.reduce((s, r) => s + r.counts[best], 0);
    return total > bestTotal ? h : best;
  }, 0);

  return (
    <div ref={ref} className="panel-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display font-semibold text-fog">Activity Heatmap</h3>
        <div className="flex items-center gap-3">
          <div className="text-[10px] font-mono text-mist">
            Peak: <span className="text-fog">{peakHour}:00</span>
          </div>
          <div className="text-[10px] font-mono text-mist">
            Events: <span className="text-fog">{totalEvents}</span>
          </div>
        </div>
      </div>
      <p className="text-[10px] font-mono text-mist/60 mb-4">
        Hour × room — activations today ·{" "}
        <span className="text-caution/70">orange outline = after-hours activity</span>
      </p>

      <div className="flex flex-col gap-2">
        {grid.map(({ room, counts }) => (
          <div key={room} className="heatmap-row flex items-center gap-2">
            <span className="text-[10px] font-mono text-mist w-20 shrink-0 truncate">
              {ROOM_LABELS[room as keyof typeof ROOM_LABELS]}
            </span>
            <div className="flex gap-[2px] flex-1">
              {counts.map((count, h) => (
                <HeatCell key={h} count={count} max={max} hour={h} room={room} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between text-[9px] font-mono text-mist/50 pl-[88px] mt-2">
        {hours.map((h) =>
          HOUR_LABELS[h] !== undefined ? (
            <span key={h}>{HOUR_LABELS[h]}</span>
          ) : null
        )}
      </div>

      {/* Scale legend */}
      <div className="flex items-center gap-2 mt-3 pl-[88px]">
        <span className="text-[9px] font-mono text-mist/50">Less</span>
        {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((o) => (
          <div
            key={o}
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: o === 0 ? "rgba(203,213,225,0.4)" : `rgba(13,148,136,${o})` }}
          />
        ))}
        <span className="text-[9px] font-mono text-mist/50">More</span>
      </div>
    </div>
  );
}
