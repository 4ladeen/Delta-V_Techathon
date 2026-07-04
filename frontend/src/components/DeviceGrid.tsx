import { useRef, useEffect } from "react";
import gsap from "gsap";
import { Device, RoomId, ROOM_IDS, ROOM_LABELS } from "@drishti/shared";

interface Props {
  devices: Device[];
  onToggle: (deviceId: string) => void;
}

function FanSvg({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/>
      <path d="M12 12c1.5-3 4-4.5 6-3.5 2 1 2 4 0 6"/>
      <path d="M12 12c-3-1.5-4.5-4-3.5-6 1-2 4-2 6 0"/>
      <path d="M12 12c1.5 3 1 6-1 7-2 1-4-1-5-4"/>
    </svg>
  );
}

function LightSvg({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="9" y1="18" x2="15" y2="18"/>
      <line x1="10" y1="22" x2="14" y2="22"/>
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>
    </svg>
  );
}

function DeviceButton({
  device,
  onToggle,
}: {
  device: Device;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const wasOn = useRef(device.isOn);

  useEffect(() => {
    if (wasOn.current !== device.isOn && ref.current) {
      gsap.fromTo(
        ref.current,
        { scale: 0.95 },
        { scale: 1, duration: 0.25, ease: "back.out(2)" }
      );
    }
    wasOn.current = device.isOn;
  }, [device.isOn]);

  const isOn = device.isOn;
  const isFan = device.kind === "fan";

  return (
    <button
      ref={ref}
      onClick={onToggle}
      className={`device-btn w-full transition-all duration-200 ${isOn ? "device-btn-on" : "device-btn-off"}`}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors shrink-0 ${
            isOn
              ? isFan
                ? "bg-pulse/15 text-pulse"
                : "bg-signal/15 text-signal"
              : "bg-void text-mist"
          }`}
        >
          {isFan ? <FanSvg /> : <LightSvg />}
        </div>
        <div className="flex flex-col items-start min-w-0">
          <span className="text-xs font-medium leading-tight truncate">{device.label}</span>
          {device.isFlapping && (
            <span className="text-[9px] font-mono text-caution">⚡ flapping</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] font-mono text-mist">{isOn ? `${device.wattage}W` : "0W"}</span>
        <div className={`w-9 h-5 rounded-full transition-all duration-300 flex items-center px-0.5 ${isOn ? "bg-pulse/30" : "bg-line"}`}>
          <div
            className={`w-4 h-4 rounded-full transition-all duration-300 shadow-sm ${
              isOn ? "translate-x-4 bg-pulse" : "translate-x-0 bg-mist/60"
            }`}
          />
        </div>
      </div>
    </button>
  );
}

export default function DeviceGrid({ devices, onToggle }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".device-col", {
        y: 16,
        opacity: 0,
        duration: 0.45,
        stagger: 0.1,
        ease: "power3.out",
      });
    }, ref);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={ref} className="panel-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display font-semibold text-fog">Device Status</h3>
        <span className="text-[10px] font-mono text-mist">
          {devices.filter((d) => d.isOn).length} active
          {devices.filter((d) => d.isFlapping).length > 0 && (
            <> · <span className="text-caution">{devices.filter((d) => d.isFlapping).length} flapping</span></>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {ROOM_IDS.map((room: RoomId) => {
          const roomDevices = devices.filter((d) => d.room === room);
          const onCount = roomDevices.filter((d) => d.isOn).length;
          return (
            <div key={room} className="device-col flex flex-col gap-2">
              <div className="flex items-center justify-between pb-1.5 border-b border-line">
                <span className="text-[11px] font-mono uppercase tracking-wider text-mist">{ROOM_LABELS[room]}</span>
                <span className={`text-[10px] font-mono ${onCount > 0 ? "text-pulse" : "text-mist/50"}`}>
                  {onCount}/{roomDevices.length}
                </span>
              </div>
              {roomDevices.map((device) => (
                <DeviceButton key={device.id} device={device} onToggle={() => onToggle(device.id)} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
