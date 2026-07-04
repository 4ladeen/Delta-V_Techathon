import { lazy, Suspense, useEffect, useRef } from "react";
import gsap from "gsap";
import { useOfficeState } from "./hooks/useOfficeState";
import OfficeLayout from "./components/OfficeLayout";
import UsagePanel from "./components/UsagePanel";
import AlertsPanel from "./components/AlertsPanel";
import DeviceGrid from "./components/DeviceGrid";
import ActivityHeatmap from "./components/ActivityHeatmap";
import AdminControls from "./components/AdminControls";
import EfficiencyLeaderboard from "./components/EfficiencyLeaderboard";
import AlertToast from "./components/AlertToast";
import LiveEventFeed from "./components/LiveEventFeed";
import OfficeHealthScore from "./components/OfficeHealthScore";
import SuggestionsPanel from "./components/SuggestionsPanel";

const PowerHistoryChart = lazy(() => import("./components/PowerHistoryChart"));

function ConnectionDot({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        {connected && (
          <span className="absolute inset-0 rounded-full bg-pulse opacity-60 animate-ping" />
        )}
        <span className={`relative w-2 h-2 rounded-full block ${connected ? "bg-pulse" : "bg-alarm"}`} />
      </div>
      <span className="text-xs font-mono text-mist">{connected ? "Live" : "Reconnecting…"}</span>
    </div>
  );
}

function VirtualClockBadge({ hour, isOverridden }: { hour: number; isOverridden: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-mono text-xs ${
      isOverridden ? "border-caution/40 bg-caution/10 text-caution" : "border-line bg-panel text-mist"
    }`}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
      <span>{String(hour).padStart(2, "0")}:00</span>
      {isOverridden && <span className="text-caution/60 text-[9px]">demo</span>}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-void">
      <div className="w-14 h-14 relative">
        <div className="absolute inset-0 rounded-full border-2 border-pulse/20 animate-spin border-t-pulse" />
        <div className="absolute inset-3 rounded-full border border-pulse/10 animate-[spin_1.8s_linear_infinite_reverse]" />
      </div>
      <div className="text-center">
        <p className="font-display font-bold text-fog text-lg">দৃষ্টি</p>
        <p className="text-xs font-mono text-mist mt-1 animate-pulse">Connecting to office backend…</p>
      </div>
    </div>
  );
}

export default function App() {
  const { state, connected, recentAlert, toggleDevice } = useOfficeState();
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state || !mainRef.current) return;
    const ctx = gsap.context(() => {
      gsap.from(".panel-card", {
        y: 22,
        opacity: 0,
        duration: 0.6,
        stagger: { amount: 0.5, from: "start" },
        ease: "power3.out",
        clearProps: "transform,opacity",
      });
    }, mainRef);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!state]);

  async function ackAlert(id: string) {
    await fetch(`/api/alerts/${id}/ack`, { method: "POST" });
  }

  if (!state) return <LoadingScreen />;

  const activeAlertCount = state.alerts.filter((a) => !a.acknowledged).length;
  const critCount = state.alerts.filter((a) => !a.acknowledged && a.severity === "critical").length;

  return (
    <div className="min-h-screen bg-void">
      {recentAlert && <AlertToast alert={recentAlert} />}

      {/* Sticky Header */}
      <header className="sticky top-0 z-40 border-b border-line bg-void/85 backdrop-blur-xl">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          {/* Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-pulse to-pulseDeep flex items-center justify-center shadow-pulseGlow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
              </svg>
            </div>
            <div className="leading-none">
              <span className="font-display font-bold text-fog text-sm">দৃষ্টি</span>
              <span className="text-mist font-mono text-xs ml-1.5 hidden sm:inline opacity-70">/ Drishti</span>
            </div>
          </div>

          {/* Center: quick stats */}
          <div className="hidden md:flex items-center gap-4 text-[11px] font-mono text-mist">
            <span>
              <span className="text-fog font-semibold">{state.usage.totalWatts}W</span> live
            </span>
            <span className="text-line">|</span>
            <span>
              <span className="text-fog font-semibold">{state.devices.filter((d) => d.isOn).length}</span>/{state.devices.length} on
            </span>
            {critCount > 0 && (
              <>
                <span className="text-line">|</span>
                <span className="text-alarm font-semibold animate-pulse">{critCount} critical alert{critCount > 1 ? "s" : ""}</span>
              </>
            )}
          </div>

          {/* Right: status */}
          <div className="flex items-center gap-3 shrink-0">
            {activeAlertCount > 0 && (
              <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-mono border ${
                critCount > 0 ? "border-alarm/30 bg-alarm/10 text-alarm" : "border-caution/30 bg-caution/10 text-caution"
              }`}>
                <span>⚠</span>
                <span>{activeAlertCount} alert{activeAlertCount > 1 ? "s" : ""}</span>
              </div>
            )}
            <VirtualClockBadge hour={state.virtualClock.hour} isOverridden={state.virtualClock.isOverridden} />
            <ConnectionDot connected={connected} />
          </div>
        </div>
      </header>

      {/* Main */}
      <main ref={mainRef} className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-5">

        {/* Row 1: Usage overview */}
        <UsagePanel usage={state.usage} />

        {/* Row 2: Health + Office Layout + Alerts sidebar */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-5">
          {/* Health score */}
          <div className="xl:col-span-1">
            <OfficeHealthScore state={state} />
          </div>
          {/* Floor plan */}
          <div className="xl:col-span-2">
            <section className="panel-card p-5 h-full">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display font-semibold text-fog text-base">Office Floor Plan</h2>
                <span className="text-[10px] font-mono text-mist">
                  {state.devices.filter((d) => d.isOn).length}/{state.devices.length} active
                </span>
              </div>
              <OfficeLayout
                devices={state.devices}
                occupancy={state.occupancy}
                onToggle={toggleDevice}
              />
            </section>
          </div>
          {/* Alerts */}
          <div className="xl:col-span-1">
            <AlertsPanel alerts={state.alerts} onAck={ackAlert} />
          </div>
        </div>

        {/* Row 3: Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <Suspense fallback={
            <div className="panel-card p-5 h-64 flex items-center justify-center">
              <div className="w-5 h-5 rounded-full border-2 border-pulse/30 border-t-pulse animate-spin" />
            </div>
          }>
            <PowerHistoryChart />
          </Suspense>
          <ActivityHeatmap />
        </div>

        {/* Row 4: Device grid + Event feed + Efficiency */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
          <div className="xl:col-span-2">
            <DeviceGrid devices={state.devices} onToggle={toggleDevice} />
          </div>
          <div className="flex flex-col gap-5">
            <EfficiencyLeaderboard />
            <LiveEventFeed />
          </div>
        </div>

        {/* Row 5: Suggestions + Admin controls */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <SuggestionsPanel />
          <AdminControls />
        </div>

      </main>

      <footer className="text-center py-6 text-[10px] font-mono text-mist/50 border-t border-line mt-2 space-y-1">
        <div>দৃষ্টি (Drishti) — Office Energy Intelligence &nbsp;·&nbsp; Techathon Nationals 2026 &nbsp;·&nbsp; Team Delta V &nbsp;·&nbsp; IUT Robotics Society</div>
        <div className="text-mist/30">Event-sourced architecture &nbsp;·&nbsp; Single source of truth &nbsp;·&nbsp; WebSocket push &nbsp;·&nbsp; 4-provider LLM fallback</div>
      </footer>
    </div>
  );
}
