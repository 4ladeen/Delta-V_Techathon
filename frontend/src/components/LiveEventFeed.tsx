import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { DeviceEvent, ROOM_LABELS } from "@drishti/shared";

const KIND_ICON: Record<string, string> = {
  fan: "🌀",
  light: "💡",
};

function EventRow({ event }: { event: DeviceEvent & { kind: string; label: string } }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ctx = gsap.context(() => {
      gsap.from(el, {
        x: -20,
        opacity: 0,
        duration: 0.35,
        ease: "power2.out",
      });
    });
    return () => ctx.revert();
  }, []);

  const isOn = event.isOn;
  const timeStr = new Date(event.timestamp).toLocaleTimeString("en-BD", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div
      ref={ref}
      className={`flex items-center gap-2.5 py-1.5 px-3 rounded-lg text-xs transition-colors ${
        isOn
          ? "bg-pulse/5 border-l-2 border-pulse/40"
          : "bg-void/40 border-l-2 border-line"
      }`}
    >
      <span className="text-sm leading-none shrink-0">{KIND_ICON[event.kind] ?? "📟"}</span>
      <div className="flex-1 min-w-0">
        <span className={`font-medium ${isOn ? "text-fog" : "text-mist"}`}>
          {event.label}
        </span>
        <span className="text-mist mx-1">·</span>
        <span className="text-mist text-[10px]">{ROOM_LABELS[event.room as keyof typeof ROOM_LABELS]}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className={`badge text-[9px] ${
            isOn ? "text-pulse border-pulse/30 bg-pulse/10" : "text-mist border-line bg-void"
          }`}
        >
          {isOn ? "ON" : "OFF"}
        </span>
        <span className="font-mono text-[10px] text-mist/60">{timeStr}</span>
      </div>
    </div>
  );
}

export default function LiveEventFeed() {
  const [events, setEvents] = useState<(DeviceEvent & { kind: string; label: string })[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      const since = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      fetch(`/api/events?since=${since}&limit=30`)
        .then((r) => r.json())
        .then((raw: DeviceEvent[]) => {
          const enriched = raw
            .slice()
            .reverse()
            .map((e) => {
              const kind = e.deviceId.includes("fan") ? "fan" : "light";
              const num = e.deviceId.split("_").pop();
              return {
                ...e,
                kind,
                label: `${kind === "fan" ? "Fan" : "Light"} ${num}`,
              };
            });
          setEvents(enriched);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="panel-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-display font-semibold text-fog">Live Event Feed</h3>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-pulse animate-pulse" />
          <span className="text-[10px] font-mono text-mist uppercase tracking-wider">streaming</span>
        </div>
      </div>

      <div
        ref={containerRef}
        className="flex flex-col gap-1 overflow-y-auto max-h-56"
      >
        {events.length === 0 ? (
          <p className="text-xs font-mono text-mist/60 py-4 text-center">Waiting for device events…</p>
        ) : (
          events.map((e) => <EventRow key={e.id} event={e} />)
        )}
      </div>
    </div>
  );
}
