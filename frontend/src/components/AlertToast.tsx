import { useEffect, useRef } from "react";
import gsap from "gsap";
import { Alert } from "@drishti/shared";

const SEVERITY_ICON: Record<string, string> = {
  critical: "🔥",
  warning: "⚠️",
  info: "ℹ️",
};

const SEVERITY_COLOR: Record<string, string> = {
  critical: "border-alarm/50 bg-alarm/10 text-alarm",
  warning: "border-caution/50 bg-caution/10 text-caution",
  info: "border-pulse/50 bg-pulse/10 text-pulse",
};

export default function AlertToast({ alert }: { alert: Alert }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const tl = gsap.timeline();
    tl.fromTo(
      el,
      { x: 80, opacity: 0, scale: 0.95 },
      { x: 0, opacity: 1, scale: 1, duration: 0.45, ease: "power3.out" }
    );
    return () => { tl.kill(); };
  }, [alert.id]);

  return (
    <div
      ref={ref}
      className={`fixed top-16 right-4 z-50 max-w-xs rounded-xl border px-4 py-3 shadow-card backdrop-blur-xl ${SEVERITY_COLOR[alert.severity]}`}
    >
      <div className="flex items-start gap-2.5">
        <span className="text-base leading-none mt-0.5">{SEVERITY_ICON[alert.severity]}</span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-wider mb-1 opacity-70">
            New Alert · {alert.severity}
          </p>
          <p className="text-xs text-fog leading-relaxed">{alert.message}</p>
        </div>
      </div>
    </div>
  );
}
