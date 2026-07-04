import { useEffect, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { UsageHistoryPoint } from "@drishti/shared";

function formatHour(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-panel border border-line rounded-xl px-3 py-2 shadow-card text-xs">
      <p className="font-mono text-mist mb-1">{label}</p>
      <p className="font-display font-semibold text-pulse">{payload[0]?.value ?? 0} W</p>
    </div>
  );
}

export default function PowerHistoryChart() {
  const [history, setHistory] = useState<UsageHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      fetch("/api/usage/history?bucketMinutes=20")
        .then((r) => r.json())
        .then((d) => { setHistory(d); setLoading(false); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  const data = history.map((p) => ({ time: formatHour(p.timestamp), watts: p.watts }));
  const peak = Math.max(...data.map((d) => d.watts), 0);
  const avg = data.length ? Math.round(data.reduce((s, d) => s + d.watts, 0) / data.length) : 0;
  const currentHour = new Date().getHours();
  const offHours = (currentHour < 9 || currentHour >= 17);

  return (
    <div className="panel-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="font-display font-semibold text-fog">Power Draw — Today</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-mist">
            <span>Peak:</span>
            <span className="text-fog">{peak}W</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-mist">
            <span>Avg:</span>
            <span className="text-fog">{avg}W</span>
          </div>
        </div>
      </div>
      <p className="text-[10px] font-mono text-mist/60 mb-4">Reconstructed from event log — not interpolated</p>

      {loading ? (
        <div className="h-48 flex items-center justify-center">
          <div className="w-5 h-5 rounded-full border-2 border-pulse/30 border-t-pulse animate-spin" />
        </div>
      ) : (
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="wattGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0D9488" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#0D9488" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid
                stroke="#CBD5E1"
                strokeDasharray="3 3"
                vertical={false}
              />
              {offHours && (
                <ReferenceLine
                  x={formatHour(new Date(new Date().setHours(17, 0, 0, 0)).toISOString())}
                  stroke="#EA580C"
                  strokeDasharray="4 2"
                  strokeWidth={1}
                  label={{ value: "5PM", fill: "#EA580C", fontSize: 9 }}
                />
              )}
              <XAxis
                dataKey="time"
                stroke="#CBD5E1"
                tick={{ fill: "#64748B", fontSize: 10, fontFamily: "JetBrains Mono" }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke="#CBD5E1"
                tick={{ fill: "#64748B", fontSize: 10, fontFamily: "JetBrains Mono" }}
                tickLine={false}
                unit="W"
                axisLine={false}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="watts"
                stroke="#0D9488"
                strokeWidth={2}
                fill="url(#wattGrad)"
                dot={false}
                activeDot={{ r: 4, fill: "#0D9488", stroke: "#FFFFFF", strokeWidth: 2 }}
                isAnimationActive={true}
                animationDuration={600}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
