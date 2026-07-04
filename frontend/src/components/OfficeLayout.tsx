import { useEffect, useRef } from "react";
import gsap from "gsap";
import { Device, RoomId, ROOM_LABELS, OccupancySignal } from "@drishti/shared";

interface Props {
  devices: Device[];
  occupancy?: OccupancySignal[];
  onToggle: (deviceId: string) => void;
}

const ROOMS: { room: RoomId; x: number; width: number; label: string }[] = [
  { room: "drawing_room",  x: 0,   width: 220, label: "Drawing Room"  },
  { room: "work_room_1",   x: 240, width: 220, label: "Work Room 1"   },
  { room: "work_room_2",   x: 480, width: 220, label: "Work Room 2"   },
];

const SVG_H = 280;

function FanBlade({ deg, on }: { deg: number; on: boolean }) {
  return (
    <path
      d={`M0,0 Q${on ? "6" : "5"},${on ? "-10" : "-8"} 0,-16 Q${on ? "-6" : "-5"},${on ? "-10" : "-8"} 0,0`}
      fill={on ? "#0D9488" : "#94A3B8"}
      opacity={on ? 0.9 : 0.6}
      transform={`rotate(${deg})`}
    />
  );
}

function FanIcon({ on, x, y, onClick, id }: { on: boolean; x: number; y: number; onClick: () => void; id: string }) {
  const groupRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const el = groupRef.current;
    if (!el) return;
    if (on) {
      const tween = gsap.to(el, { rotation: 360, duration: 1.2, repeat: -1, ease: "none", transformOrigin: "0px 0px" });
      return () => { tween.kill(); gsap.set(el, { clearProps: "all" }); };
    } else {
      gsap.to(el, { rotation: 0, duration: 0.5, ease: "power2.out", transformOrigin: "0px 0px" });
    }
  }, [on]);

  return (
    <g
      transform={`translate(${x},${y})`}
      onClick={onClick}
      className="cursor-pointer"
      role="button"
      aria-label={`Toggle ${id}`}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {/* Glow ring */}
      {on && (
        <circle
          r="22"
          fill="rgba(13,148,136,0.08)"
          style={{ filter: "blur(3px)" }}
        />
      )}
      {/* Housing */}
      <circle
        r="20"
        fill={on ? "rgba(13,148,136,0.12)" : "rgba(248,250,252,0.8)"}
        stroke={on ? "#0D9488" : "#CBD5E1"}
        strokeWidth="1.5"
      />
      {/* Blades */}
      <g ref={groupRef} style={{ transformOrigin: "0px 0px" }}>
        {[0, 120, 240].map((deg) => (
          <FanBlade key={deg} deg={deg} on={on} />
        ))}
      </g>
      {/* Hub */}
      <circle r="3.5" fill={on ? "#0D9488" : "#64748B"} />
      {/* Label */}
      <text y="33" textAnchor="middle" className="fill-mist" fontSize="9" fontFamily="JetBrains Mono">
        {id.split("_").pop()}
      </text>
    </g>
  );
}

function LightIcon({ on, x, y, onClick, id }: { on: boolean; x: number; y: number; onClick: () => void; id: string }) {
  const glowRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const el = glowRef.current;
    if (!el) return;
    if (on) {
      const tween = gsap.to(el, {
        attr: { r: 18 },
        opacity: 0.4,
        duration: 1.8,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      return () => { tween.kill(); };
    } else {
      gsap.set(el, { attr: { r: 12 }, opacity: 0 });
    }
  }, [on]);

  return (
    <g
      transform={`translate(${x},${y})`}
      onClick={onClick}
      className="cursor-pointer"
      role="button"
      aria-label={`Toggle ${id}`}
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
    >
      {/* Animated glow */}
      <circle
        ref={glowRef}
        r={on ? 14 : 12}
        fill={on ? "#D97706" : "transparent"}
        opacity={on ? 0.3 : 0}
        style={{ filter: "blur(4px)" }}
      />
      {/* Pendant wire */}
      <line x1="0" y1="-18" x2="0" y2="-12" stroke={on ? "#D97706" : "#94A3B8"} strokeWidth="1.5" />
      {/* Bulb */}
      <ellipse
        cx="0" cy="0" rx="8" ry="10"
        fill={on ? "#D97706" : "#94A3B8"}
        stroke={on ? "#D97706" : "#94A3B8"}
        strokeWidth="1.5"
        style={on ? { filter: "drop-shadow(0 0 6px rgba(217,119,6,0.7))" } : undefined}
      />
      {/* Cap */}
      <rect x="-5" y="-12" width="10" height="4" rx="1" fill={on ? "#D97706" : "#94A3B8"} />
      {/* Label */}
      <text y="18" textAnchor="middle" className="fill-mist" fontSize="9" fontFamily="JetBrains Mono">
        {id.split("_").pop()}
      </text>
    </g>
  );
}

function Door({ x, y, side = "bottom" }: { x: number; y: number; side?: "bottom" | "right" }) {
  if (side === "right") {
    return <path d={`M${x},${y} L${x},${y + 24}`} stroke="#94A3B8" strokeWidth="3" strokeLinecap="round" fill="none" />;
  }
  return <path d={`M${x},${y} L${x + 24},${y}`} stroke="#94A3B8" strokeWidth="3" strokeLinecap="round" fill="none" />;
}

export default function OfficeLayout({ devices, occupancy = [], onToggle }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from("g[role='button']", {
        scale: 0,
        opacity: 0,
        duration: 0.5,
        stagger: 0.04,
        ease: "back.out(1.7)",
        transformOrigin: "center center",
      });
    }, containerRef);
    return () => ctx.revert();
  }, []);

  const totalWidth = 700;

  return (
    <div ref={containerRef} className="w-full">
      <div className="overflow-x-auto">
        <svg
          viewBox={`-10 -10 ${totalWidth + 20} ${SVG_H + 30}`}
          className="w-full min-w-[600px] h-auto"
          style={{ maxHeight: 320 }}
        >
          {/* Building shell */}
          <rect
            x="0" y="0" width={totalWidth} height={SVG_H}
            rx="8"
            fill="rgba(240,244,248,0.8)"
            stroke="#CBD5E1"
            strokeWidth="2"
          />

          {/* Subtle grid inside */}
          <defs>
            <pattern id="roomGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(203,213,225,0.6)" strokeWidth="0.5"/>
            </pattern>
            <filter id="lightGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <rect x="2" y="2" width={totalWidth - 4} height={SVG_H - 4} rx="6" fill="url(#roomGrid)" />

          {ROOMS.map(({ room, x, width }) => {
            const roomDevices = devices.filter((d) => d.room === room);
            const fans = roomDevices.filter((d) => d.kind === "fan");
            const lights = roomDevices.filter((d) => d.kind === "light");
            const anyOn = roomDevices.some((d) => d.isOn);
            const activeCount = roomDevices.filter((d) => d.isOn).length;
            const occ = occupancy.find((o) => o.room === room);

            return (
              <g key={room} transform={`translate(${x}, 0)`}>
                {/* Room background with glow when active */}
                <rect
                  x="8" y="8" width={width - 16} height={SVG_H - 16}
                  rx="5"
                  fill={anyOn ? "rgba(13,148,136,0.06)" : "rgba(248,250,252,0.7)"}
                  stroke={anyOn ? "rgba(13,148,136,0.3)" : "rgba(203,213,225,0.8)"}
                  strokeWidth="1"
                />

                {/* Room divider */}
                {x > 0 && (
                  <line x1="0" y1="20" x2="0" y2={SVG_H - 20} stroke="#CBD5E1" strokeWidth="2.5" />
                )}

                {/* Door cutout hint */}
                <Door x={x < 10 ? 50 : 30} y={SVG_H - 8} />

                {/* Room label */}
                <text x="18" y="28" fill="#94A3B8" fontSize="11" fontFamily="'Space Grotesk', sans-serif" fontWeight="600">
                  {ROOM_LABELS[room]}
                </text>

                {/* Active device count */}
                <text x={width - 20} y="28" textAnchor="end" fill={anyOn ? "#0D9488" : "#64748B"} fontSize="9" fontFamily="'JetBrains Mono', monospace">
                  {activeCount}/{roomDevices.length}
                </text>

                {/* Occupancy indicator */}
                <g transform={`translate(${width - 20}, 46)`}>
                  <circle r="4" fill={occ?.occupied ? "rgba(34,197,94,0.2)" : "rgba(203,213,225,0.5)"} stroke={occ?.occupied ? "#16A34A" : "#94A3B8"} strokeWidth="1" />
                  {occ?.occupied && <circle r="2" fill="#16A34A" />}
                </g>

                {/* Fans row - centered */}
                {fans.map((fan, i) => (
                  <FanIcon
                    key={fan.id}
                    id={fan.id}
                    on={fan.isOn}
                    x={width / 2 + (i - (fans.length - 1) / 2) * 58}
                    y={100}
                    onClick={() => onToggle(fan.id)}
                  />
                ))}

                {/* Lights row */}
                {lights.map((light, i) => (
                  <LightIcon
                    key={light.id}
                    id={light.id}
                    on={light.isOn}
                    x={width / 2 + (i - (lights.length - 1) / 2) * 55}
                    y={195}
                    onClick={() => onToggle(light.id)}
                  />
                ))}
              </g>
            );
          })}

          {/* Legend */}
          <g transform={`translate(10, ${SVG_H + 10})`}>
            <circle r="4" fill="rgba(13,148,136,0.2)" stroke="#0D9488" strokeWidth="1" cy="0" cx="0" />
            <text x="8" y="4" fill="#64748B" fontSize="9" fontFamily="'JetBrains Mono', monospace">Fan</text>
            <ellipse cx="55" cy="0" rx="5" ry="6" fill="rgba(217,119,6,0.2)" stroke="#D97706" strokeWidth="1" />
            <text x="63" y="4" fill="#64748B" fontSize="9" fontFamily="'JetBrains Mono', monospace">Light</text>
            <circle r="4" cx="115" cy="0" fill="rgba(34,197,94,0.2)" stroke="#16A34A" strokeWidth="1" />
            <text x="123" y="4" fill="#64748B" fontSize="9" fontFamily="'JetBrains Mono', monospace">Occupied</text>
            <text x="250" y="4" fill="#64748B" fontSize="9" fontFamily="'JetBrains Mono', monospace">Click any device to toggle</text>
          </g>
        </svg>
      </div>
    </div>
  );
}
