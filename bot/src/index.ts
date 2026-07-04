import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  TextChannel,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ActivityType,
} from "discord.js";
import {
  fetchFullState,
  fetchEfficiency,
  fetchStats,
  fetchSuggestions,
  toggleRoom,
  shutdownAllDevices,
  findRoomDevices,
  fetchEventsCsv,
  OfficeStats,
  EnergySuggestion,
} from "./backendClient";
import { generateWithFallback } from "./llm/fallbackChain";
import {
  statusTemplate,
  roomTemplate,
  usageTemplate,
  alertAnnouncementTemplate,
  statsTemplate,
} from "./llm/templates";
import { AlertSeverity, OfficeState, RoomEfficiency } from "@drishti/shared";

// ── Constants ────────────────────────────────────────────────────────────────

const PREFIX = "!";
const POLL_INTERVAL_MS = 15_000;
const BRAND_COLOR   = 0x2dd4bf;
const SUCCESS_COLOR = 0x22c55e;
const WARN_COLOR    = 0xf97316;
const DANGER_COLOR  = 0xef4444;
const MUTED_COLOR   = 0x64748b;

const ALERT_COLORS: Record<AlertSeverity, number> = {
  info: BRAND_COLOR, warning: WARN_COLOR, critical: DANGER_COLOR,
};
const ALERT_EMOJI: Record<AlertSeverity, string> = {
  info: "ℹ️", warning: "⚠️", critical: "🔥",
};
const GRADE_EMOJI: Record<string, string> = {
  A: "🟢", B: "🔵", C: "🟡", D: "🟠", F: "🔴",
};
const ROOM_LABELS: Record<string, string> = {
  drawing_room: "Drawing Room",
  work_room_1: "Work Room 1",
  work_room_2: "Work Room 2",
};
const ROOM_IDS = ["drawing_room", "work_room_1", "work_room_2"] as const;

// ── Discord client ───────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const knownAlertIds = new Set<string>();

// ── Slash command definitions ────────────────────────────────────────────────

const ROOM_CHOICES = [
  { name: "Drawing Room",  value: "drawing_room"  },
  { name: "Work Room 1",   value: "work_room_1"   },
  { name: "Work Room 2",   value: "work_room_2"   },
];

const DEVICE_KIND_CHOICES = [
  { name: "All devices",  value: "all"   },
  { name: "Fans only",    value: "fan"   },
  { name: "Lights only",  value: "light" },
];

const slashCommands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Live report of every room — devices, load, occupancy"),

  new SlashCommandBuilder()
    .setName("room")
    .setDescription("Detailed status of a specific room")
    .addStringOption((o) =>
      o.setName("name").setDescription("Room").setRequired(true).addChoices(...ROOM_CHOICES)
    ),

  new SlashCommandBuilder()
    .setName("usage")
    .setDescription("Live power draw, kWh today, cost and CO₂ estimate"),

  new SlashCommandBuilder()
    .setName("report")
    .setDescription("Full summary card — usage, alerts, efficiency grades"),

  new SlashCommandBuilder()
    .setName("alerts")
    .setDescription("List every active alert right now, sorted by severity"),

  new SlashCommandBuilder()
    .setName("efficiency")
    .setDescription("Room efficiency leaderboard — A-F grades for today"),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Deep office statistics — peak, per-room, flapping devices"),

  new SlashCommandBuilder()
    .setName("compare")
    .setDescription("Side-by-side room comparison — load, alerts, efficiency"),

  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("AI-generated energy-saving suggestions based on current state"),

  new SlashCommandBuilder()
    .setName("turn")
    .setDescription("Toggle devices in a room — all, fans only, or lights only")
    .addStringOption((o) =>
      o.setName("room").setDescription("Room").setRequired(true).addChoices(...ROOM_CHOICES)
    )
    .addStringOption((o) =>
      o.setName("state").setDescription("On or off").setRequired(true)
        .addChoices({ name: "On", value: "on" }, { name: "Off", value: "off" })
    )
    .addStringOption((o) =>
      o.setName("kind").setDescription("Device type (default: all)")
        .addChoices(...DEVICE_KIND_CHOICES)
    ),

  new SlashCommandBuilder()
    .setName("shutdown")
    .setDescription("Emergency: turn off devices office-wide or filtered by type/room")
    .addStringOption((o) =>
      o.setName("kind").setDescription("Device type (default: all)")
        .addChoices(...DEVICE_KIND_CHOICES)
    )
    .addStringOption((o) =>
      o.setName("room").setDescription("Limit to one room (default: entire building)")
        .addChoices(...ROOM_CHOICES)
    ),

  new SlashCommandBuilder()
    .setName("export")
    .setDescription("Download today's raw device event log as CSV"),

  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency and backend connectivity"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all Drishti commands"),
].map((cmd) => cmd.toJSON());

async function registerSlashCommands(): Promise<void> {
  if (!process.env.DISCORD_BOT_TOKEN || !client.user) return;
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    // Register globally
    await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands });
    console.log("  [bot] ✓ slash commands registered globally");

    // Register per guild the bot is in to make them show up instantly
    for (const guild of client.guilds.cache.values()) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body: slashCommands });
      console.log(`  [bot] ✓ slash commands registered instantly for guild: ${guild.name} (${guild.id})`);
    }
  } catch (err) {
    console.error("  [bot] ✗ slash command registration failed:", (err as Error).message);
  }
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function footer(provider = "template"): string {
  const time = new Date().toLocaleTimeString("en-BD", { hour: "2-digit", minute: "2-digit" });
  return `দৃষ্টি Drishti · ${provider} · ${time}`;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

function stateContext(state: OfficeState): string {
  const on = state.devices.filter((d) => d.isOn);
  const alerts = state.alerts.filter((a) => !a.acknowledged);
  const lines = [
    `Office has ${on.length}/${state.devices.length} devices currently ON, drawing ${state.usage.totalWatts}W total.`,
    `Today's consumption: ${state.usage.estimatedKwhToday.toFixed(3)} kWh, ৳${state.usage.estimatedCostBdt.toFixed(2)}, ${state.usage.estimatedCo2Kg.toFixed(3)}kg CO₂.`,
    `Virtual clock shows ${String(state.virtualClock.hour).padStart(2, "0")}:00${state.virtualClock.isOverridden ? " (demo override)" : ""}.`,
  ];
  if (alerts.length > 0) {
    lines.push(`Active alerts: ${alerts.map((a) => `${a.severity} ${a.type} in ${ROOM_LABELS[a.room] ?? a.room}`).join("; ")}.`);
  }
  for (const r of state.usage.perRoom) {
    if (r.totalWatts > 0) lines.push(`${r.label}: ${r.totalWatts}W (${r.devicesOn}/${r.devicesTotal} on).`);
  }
  return lines.join(" ");
}

// ── Embed builders ───────────────────────────────────────────────────────────

async function buildStatusEmbed(): Promise<{ embed: EmbedBuilder; provider: string }> {
  const state = await fetchFullState();
  const ctx = stateContext(state);

  const result = await generateWithFallback(
    "Write a concise 2-sentence office status summary for the boss. Include total load and any rooms with issues. Conversational tone, no lists.",
    () => statusTemplate(state),
    `Current office data:\n${ctx}`
  );

  const embed = new EmbedBuilder()
    .setTitle("🏢 Office Status")
    .setDescription(result.text)
    .setColor(
      state.alerts.some((a) => !a.acknowledged && a.severity === "critical")
        ? DANGER_COLOR
        : state.alerts.some((a) => !a.acknowledged && a.severity === "warning")
        ? WARN_COLOR
        : BRAND_COLOR
    )
    .setTimestamp()
    .setFooter({ text: footer(result.provider) });

  for (const roomId of ROOM_IDS) {
    const rDevs = state.devices.filter((d) => d.room === roomId);
    const on = rDevs.filter((d) => d.isOn);
    const occ = state.occupancy.find((o) => o.room === roomId);
    const rAlerts = state.alerts.filter((a) => !a.acknowledged && a.room === roomId);
    const watts = on.reduce((s, d) => s + d.wattage, 0);
    const fans = on.filter((d) => d.kind === "fan").length;
    const lights = on.filter((d) => d.kind === "light").length;
    const flapping = rDevs.filter((d) => d.isFlapping).length;

    const status = on.length === 0 ? "All off" : [
      fans ? `${fans} fan${fans > 1 ? "s" : ""} 🌀` : null,
      lights ? `${lights} light${lights > 1 ? "s" : ""} 💡` : null,
      `**${watts}W**`,
    ].filter(Boolean).join(" · ");

    const lines = [
      `${on.length > 0 ? "🟢" : "⚫"} ${status}`,
      occ?.occupied ? "👤 Occupied" : "👻 Unoccupied",
      flapping > 0 ? `⚡ ${flapping} device(s) flapping` : null,
      rAlerts.length > 0 ? `⚠️ ${rAlerts.length} alert(s)` : "✅ No alerts",
    ].filter(Boolean);

    embed.addFields({ name: ROOM_LABELS[roomId], value: lines.join("\n"), inline: true });
  }

  embed.addFields({
    name: "​",
    value: `**${state.alerts.filter((a) => !a.acknowledged).length}** active alert(s) · **${state.devices.filter((d) => d.isOn).length}/${state.devices.length}** devices on`,
    inline: false,
  });

  return { embed, provider: result.provider };
}

async function buildUsageEmbed(): Promise<EmbedBuilder> {
  const state = await fetchFullState();
  const u = state.usage;

  const result = await generateWithFallback(
    "Write 1-2 sentences about this office's current energy consumption. Be specific about the numbers. Friendly tone.",
    () => usageTemplate(state),
    stateContext(state)
  );

  return new EmbedBuilder()
    .setTitle("⚡ Energy Usage")
    .setDescription(result.text)
    .setColor(BRAND_COLOR)
    .addFields(
      { name: "🔌 Live Load",    value: `**${u.totalWatts}W**`,                   inline: true },
      { name: "📊 Today",        value: `**${u.estimatedKwhToday.toFixed(3)} kWh**`, inline: true },
      { name: "💰 Est. Cost",    value: `**৳ ${u.estimatedCostBdt.toFixed(2)}**`,  inline: true },
      { name: "🌱 CO₂",          value: `**${u.estimatedCo2Kg.toFixed(3)} kg**`,    inline: true },
      { name: "📈 Projected/Day",value: `**${u.projectedKwhFullDay.toFixed(2)} kWh**`, inline: true },
      { name: "🕐 Time",         value: `**${String(state.virtualClock.hour).padStart(2, "0")}:00**${state.virtualClock.isOverridden ? " *(demo)*" : ""}`, inline: true },
      {
        name: "Per Room",
        value: u.perRoom.map((r) =>
          `${r.totalWatts > 0 ? "🟢" : "⚫"} **${r.label}**: ${r.totalWatts}W (${r.devicesOn}/${r.devicesTotal} on)`
        ).join("\n"),
      }
    )
    .setTimestamp()
    .setFooter({ text: footer(result.provider) });
}

async function buildReportEmbed(): Promise<EmbedBuilder> {
  const [state, efficiency] = await Promise.all([fetchFullState(), fetchEfficiency()]);
  const u = state.usage;
  const activeAlerts = state.alerts.filter((a) => !a.acknowledged);
  const critCount = activeAlerts.filter((a) => a.severity === "critical").length;
  const warnCount = activeAlerts.filter((a) => a.severity === "warning").length;

  const healthLine =
    critCount > 0 ? "🔴 Critical issues require attention"
    : warnCount > 0 ? "🟡 Office has warnings — review alerts"
    : "🟢 Office is running efficiently";

  const healthColor = critCount > 0 ? DANGER_COLOR : warnCount > 0 ? WARN_COLOR : SUCCESS_COLOR;

  const embed = new EmbedBuilder()
    .setTitle("📊 Office Energy Report")
    .setDescription(`${healthLine}\n**${state.devices.filter((d) => d.isOn).length}/${state.devices.length}** devices on · **${u.totalWatts}W** live load`)
    .setColor(healthColor)
    .addFields(
      { name: "⚡ Load",    value: `${u.totalWatts}W`,                     inline: true },
      { name: "📊 kWh",    value: `${u.estimatedKwhToday.toFixed(3)} kWh`, inline: true },
      { name: "💰 Cost",   value: `৳ ${u.estimatedCostBdt.toFixed(2)}`,    inline: true },
      { name: "🌱 CO₂",   value: `${u.estimatedCo2Kg.toFixed(3)} kg`,     inline: true },
      { name: "🔔 Alerts", value: `${critCount} crit · ${warnCount} warn · ${activeAlerts.length} total`, inline: true },
      { name: "📈 Proj.",  value: `${u.projectedKwhFullDay.toFixed(2)} kWh/day`, inline: true }
    );

  if (efficiency.length > 0) {
    embed.addFields({
      name: "🏆 Efficiency",
      value: efficiency.map((e: RoomEfficiency, i: number) =>
        `${["🥇","🥈","🥉"][i] ?? `#${i+1}`} **${e.label}**: ${GRADE_EMOJI[e.grade]} ${e.grade} (${e.score}/100 · ${e.incidentsToday} inc.)`
      ).join("\n"),
    });
  }

  if (activeAlerts.length > 0) {
    embed.addFields({
      name: "🚨 Active Alerts",
      value: activeAlerts.slice(0, 5).map((a) =>
        `${ALERT_EMOJI[a.severity]} **${a.type.replace(/_/g, " ")}** — ${a.message.substring(0, 75)}${a.message.length > 75 ? "…" : ""}`
      ).join("\n") + (activeAlerts.length > 5 ? `\n*…and ${activeAlerts.length - 5} more*` : ""),
    });
  }

  return embed.setTimestamp().setFooter({ text: footer() });
}

async function buildAlertsEmbed(): Promise<EmbedBuilder> {
  const state = await fetchFullState();
  const active = state.alerts.filter((a) => !a.acknowledged).sort((a, b) => {
    const ord = { critical: 0, warning: 1, info: 2 };
    return ord[a.severity] - ord[b.severity];
  });

  const color = active.some((a) => a.severity === "critical") ? DANGER_COLOR
    : active.some((a) => a.severity === "warning") ? WARN_COLOR
    : active.length > 0 ? BRAND_COLOR
    : SUCCESS_COLOR;

  const embed = new EmbedBuilder()
    .setTitle("🚨 Active Alerts")
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: footer() });

  if (active.length === 0) {
    return embed.setDescription("✅ No active alerts — office is behaving normally.");
  }

  embed.setDescription(`**${active.length}** active alert${active.length > 1 ? "s" : ""} — sorted by severity.`);

  for (const a of active.slice(0, 10)) {
    embed.addFields({
      name: `${ALERT_EMOJI[a.severity]} ${a.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`,
      value: `${a.message}\n*${ROOM_LABELS[a.room] ?? a.room} · ${timeAgo(a.createdAt)}*`,
    });
  }

  return embed;
}

async function buildEfficiencyEmbed(): Promise<EmbedBuilder> {
  const eff = await fetchEfficiency();
  const embed = new EmbedBuilder()
    .setTitle("🏆 Room Efficiency Leaderboard")
    .setDescription("Today's track record. Score starts at 100 — each alert deducts points (info −2, warning −5, critical −12). Resolved incidents still count.")
    .setColor(BRAND_COLOR)
    .setTimestamp()
    .setFooter({ text: footer() });

  const RANK = ["🥇","🥈","🥉"];
  eff.forEach((e: RoomEfficiency, i: number) => {
    const bar = "█".repeat(Math.round(e.score / 10)) + "░".repeat(10 - Math.round(e.score / 10));
    embed.addFields({
      name: `${RANK[i] ?? `#${i+1}`} ${e.label}`,
      value: [
        `${GRADE_EMOJI[e.grade]} Grade **${e.grade}** — Score **${e.score}/100**`,
        `\`${bar}\` ${e.score}%`,
        `📋 ${e.incidentsToday} incident${e.incidentsToday !== 1 ? "s" : ""} today`,
      ].join("\n"),
    });
  });

  return embed;
}

async function buildStatsEmbed(): Promise<EmbedBuilder> {
  const [stats, state] = await Promise.all([fetchStats() as Promise<OfficeStats>, fetchFullState()]);
  const s = stats.summary;
  const a = stats.alerts;

  const result = await generateWithFallback(
    "Summarize these office statistics in 1 sentence. Focus on the most important metric right now.",
    () => statsTemplate(state),
    stateContext(state)
  );

  const embed = new EmbedBuilder()
    .setTitle("📈 Office Statistics")
    .setDescription(result.text)
    .setColor(BRAND_COLOR)
    .addFields(
      { name: "🔌 Live Load",    value: `${s.totalWatts}W`,                     inline: true },
      { name: "⚡ Peak Today",   value: `${s.peakWattsToday}W`,                 inline: true },
      { name: "📊 kWh Today",    value: `${s.kwhToday.toFixed(3)} kWh`,         inline: true },
      { name: "💰 Cost Today",   value: `৳ ${s.costToday.toFixed(2)}`,          inline: true },
      { name: "🌱 CO₂ Today",    value: `${s.co2Today.toFixed(3)} kg`,          inline: true },
      { name: "📈 Projected",    value: `${s.projectedKwh.toFixed(2)} kWh`,     inline: true },
      { name: "🔔 Alerts",       value: `${a.raisedToday} raised · ${a.active} active (${a.critical} crit, ${a.warning} warn)`, inline: false },
      { name: "📟 Devices",      value: `${s.devicesOn}/${s.totalDevices} on · ${s.devicesFlapping} flapping`, inline: false },
      {
        name: "Per Room",
        value: stats.rooms.map((r) =>
          `**${ROOM_LABELS[r.room] ?? r.room}**: ${r.watts}W · ${r.devicesOn}/${r.devicesTotal} on · ${r.activeAlerts} alert(s) · ${r.eventsToday} events today`
        ).join("\n"),
      },
    );

  if (stats.flappingDevices.length > 0) {
    embed.addFields({
      name: "⚡ Flapping Devices",
      value: stats.flappingDevices.map((d) => `• **${d.label}** — ${ROOM_LABELS[d.room] ?? d.room}`).join("\n"),
    });
  }

  return embed.setTimestamp().setFooter({ text: footer(result.provider) });
}

async function buildCompareEmbed(): Promise<EmbedBuilder> {
  const [state, eff] = await Promise.all([fetchFullState(), fetchEfficiency()]);

  const result = await generateWithFallback(
    "In one sentence, which room needs the most attention right now and why?",
    () => "Rooms compared — see breakdown below.",
    stateContext(state)
  );

  const embed = new EmbedBuilder()
    .setTitle("🔄 Room Comparison")
    .setDescription(result.text)
    .setColor(BRAND_COLOR)
    .setTimestamp()
    .setFooter({ text: footer(result.provider) });

  for (const roomId of ROOM_IDS) {
    const devs = state.devices.filter((d) => d.room === roomId);
    const on = devs.filter((d) => d.isOn);
    const watts = on.reduce((s, d) => s + d.wattage, 0);
    const occ = state.occupancy.find((o) => o.room === roomId);
    const e = eff.find((x: RoomEfficiency) => x.room === roomId);
    const rAlerts = state.alerts.filter((a) => !a.acknowledged && a.room === roomId);
    const bar = "█".repeat(Math.round((e?.score ?? 100) / 10)) + "░".repeat(10 - Math.round((e?.score ?? 100) / 10));

    embed.addFields({
      name: `${on.length > 0 ? "🟢" : "⚫"} ${ROOM_LABELS[roomId]}`,
      value: [
        `**${on.length}/${devs.length}** on · **${watts}W**`,
        occ?.occupied ? "👤 Occupied" : "👻 Empty",
        `${GRADE_EMOJI[e?.grade ?? "A"]} **${e?.grade ?? "A"}** (${e?.score ?? 100}/100)`,
        `\`${bar}\``,
        rAlerts.length > 0 ? `⚠️ ${rAlerts.length} alert(s)` : "✅ Clean",
      ].join("\n"),
      inline: true,
    });
  }

  return embed;
}

async function buildSuggestEmbed(): Promise<EmbedBuilder> {
  const [state, sugs] = await Promise.all([fetchFullState(), fetchSuggestions() as Promise<EnergySuggestion[]>]);

  if (sugs.length === 0) {
    const result = await generateWithFallback(
      "The office looks efficient right now. Write one encouraging sentence about that.",
      () => "✅ No savings opportunities identified — everything looks good!",
      stateContext(state)
    );
    return new EmbedBuilder()
      .setTitle("✨ Energy Suggestions")
      .setDescription(result.text)
      .setColor(SUCCESS_COLOR)
      .setTimestamp()
      .setFooter({ text: footer(result.provider) });
  }

  const topPriority = sugs[0].priority === "high" ? DANGER_COLOR : WARN_COLOR;
  const PEMOJI: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };

  const embed = new EmbedBuilder()
    .setTitle("💡 Energy-Saving Suggestions")
    .setDescription(`**${sugs.length}** actionable suggestion${sugs.length > 1 ? "s" : ""} based on current office state.`)
    .setColor(topPriority)
    .setTimestamp()
    .setFooter({ text: footer() });

  for (const s of sugs.slice(0, 5)) {
    embed.addFields({
      name: `${PEMOJI[s.priority] ?? "•"} ${s.action}`,
      value: `${s.reason}\n*Saving: −${s.estimatedSavingWatts}W · ${s.rooms.join(", ")}*`,
    });
  }

  return embed;
}

function buildHelpEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle("দৃষ্টি (Drishti) — Commands")
    .setDescription("Real-time office energy intelligence. All commands fetch live backend data.\nAll commands work as both prefix (`!cmd`) and slash (`/cmd`).")
    .setColor(BRAND_COLOR)
    .addFields(
      {
        name: "📊 Status & Monitoring",
        value: [
          "`status` — Live report of all three rooms",
          "`room <name>` — Single room deep-dive",
          "`usage` — Power, kWh, cost, CO₂ breakdown",
          "`report` — Full summary card (health-coloured)",
          "`alerts` — Active alerts by severity",
          "`efficiency` — A-F leaderboard for today",
          "`stats` — Deep statistics, peak, per-room",
          "`compare` — Rooms side-by-side",
          "`suggest` — AI energy-saving recommendations",
        ].join("\n"),
      },
      {
        name: "🎛 Control",
        value: [
          "`turn <room|all> [fans|lights] <on|off>` — Granular toggle",
          "  e.g. `!turn drawing fans off`, `!turn all lights off`",
          "`shutdown [fans|lights] [room]` *(admin)* — Emergency off",
          "  e.g. `!shutdown fans`, `!shutdown lights drawing`",
        ].join("\n"),
      },
      {
        name: "📁 Utilities",
        value: [
          "`export` — Today's event log as CSV",
          "`ping` — Bot + backend latency",
          "`help` — This menu",
        ].join("\n"),
      },
      {
        name: "🤖 AI Engine",
        value: "Groq (llama-3.3-70b) → Gemini (gemini-2.0-flash) → OpenRouter → templates.\nBot always responds even with no internet — template fallback covers zero-connectivity.",
      }
    )
    .setFooter({ text: "Techathon Nationals 2026 · Team Delta V · IUT Robotics Society" })
    .setTimestamp();
}

// ── Shared command dispatcher ────────────────────────────────────────────────

type ReplyFn = (opts: { embeds?: EmbedBuilder[]; content?: string; files?: AttachmentBuilder[] }) => Promise<void>;
type EditFn  = (opts: { embeds?: EmbedBuilder[]; content?: string; components?: ActionRowBuilder<ButtonBuilder>[] }) => Promise<void>;

async function handleCommand(
  cmd: string,
  args: string[],
  reply: ReplyFn,
  edit: EditFn,
  userId: string,
  isAdmin: boolean,
  awaitButton?: (message: import("discord.js").Message<boolean>) => Promise<void>
): Promise<void> {
  // Simple string reply shorthand
  const replyText = (text: string) => reply({ content: text });

  switch (cmd) {
    case "status": {
      const { embed } = await buildStatusEmbed();
      await reply({ embeds: [embed] });
      break;
    }

    case "room": {
      const q = args.join(" ");
      if (!q) { await replyText("Which room? Try `drawing`, `work1`, or `work2`."); return; }
      const state = await fetchFullState();
      const { label, devices } = findRoomDevices(state, q);
      const on = devices.filter((d) => d.isOn);
      const watts = on.reduce((s, d) => s + d.wattage, 0);
      const occ = state.occupancy.find((o) => ROOM_LABELS[o.room] === label || o.room.includes(q));
      const rAlerts = state.alerts.filter((a) => !a.acknowledged && (ROOM_LABELS[a.room] === label));

      const prompt = `Status of ${label}: ${on.length}/${devices.length} devices on (${watts}W). ${occ?.occupied ? "Room is occupied." : "Room is unoccupied."} ${rAlerts.length > 0 ? `${rAlerts.length} active alert(s): ${rAlerts.map((a) => a.type).join(", ")}.` : "No active alerts."} Write one friendly sentence about this room's current state.`;
      const result = await generateWithFallback(prompt, () => roomTemplate(state, label, devices));

      const embed = new EmbedBuilder()
        .setTitle(`🚪 ${label}`)
        .setDescription(result.text)
        .setColor(rAlerts.some((a) => a.severity === "critical") ? DANGER_COLOR : on.length > 0 ? BRAND_COLOR : MUTED_COLOR)
        .addFields(
          { name: "Devices On",  value: `${on.length}/${devices.length}`,  inline: true },
          { name: "Live Load",   value: `${watts}W`,                        inline: true },
          { name: "Occupancy",   value: occ?.occupied ? "👤 Yes" : "👻 No", inline: true },
          { name: "Fans",        value: `${on.filter((d) => d.kind === "fan").length}/2 on`,   inline: true },
          { name: "Lights",      value: `${on.filter((d) => d.kind === "light").length}/3 on`, inline: true },
          { name: "Alerts",      value: rAlerts.length > 0 ? `⚠️ ${rAlerts.length}` : "✅ None", inline: true },
        )
        .setTimestamp()
        .setFooter({ text: footer(result.provider) });

      if (rAlerts.length > 0) {
        embed.addFields({
          name: "Alert Details",
          value: rAlerts.slice(0, 3).map((a) => `${ALERT_EMOJI[a.severity]} ${a.message}`).join("\n"),
        });
      }
      await reply({ embeds: [embed] });
      break;
    }

    case "usage": {
      await reply({ embeds: [await buildUsageEmbed()] });
      break;
    }

    case "report": {
      await reply({ embeds: [await buildReportEmbed()] });
      break;
    }

    case "alerts": {
      await reply({ embeds: [await buildAlertsEmbed()] });
      break;
    }

    case "efficiency": {
      await reply({ embeds: [await buildEfficiencyEmbed()] });
      break;
    }

    case "stats": {
      await reply({ embeds: [await buildStatsEmbed()] });
      break;
    }

    case "compare": {
      await reply({ embeds: [await buildCompareEmbed()] });
      break;
    }

    case "suggest":
    case "suggestions": {
      await reply({ embeds: [await buildSuggestEmbed()] });
      break;
    }

    case "turn": {
      // Enhanced: !turn <room|all> [fans|lights] <on|off>
      // Examples: !turn drawing on, !turn work1 fans off, !turn all lights off, !turn all off
      const lowerArgs = args.map((a) => a.toLowerCase());
      const stateArg = lowerArgs.find((a) => a === "on" || a === "off");
      if (!stateArg) {
        await replyText("Usage: `!turn <room|all> [fans|lights] <on|off>`\nExamples: `!turn drawing on`, `!turn work1 fans off`, `!turn all lights off`");
        return;
      }

      // Detect kind filter
      let kindFilter: "fan" | "light" | undefined;
      if (lowerArgs.includes("fans") || lowerArgs.includes("fan")) kindFilter = "fan";
      else if (lowerArgs.includes("lights") || lowerArgs.includes("light")) kindFilter = "light";

      // Detect if "all" rooms
      const isAll = lowerArgs.includes("all") || lowerArgs.includes("building") || lowerArgs.includes("office");

      const kindLabel = kindFilter === "fan" ? "fan(s)" : kindFilter === "light" ? "light(s)" : "device(s)";
      const turnedOn = stateArg === "on";

      if (isAll) {
        // Whole building
        const rooms: string[] = ["drawing_room", "work_room_1", "work_room_2"];
        let totalAffected = 0;
        for (const r of rooms) {
          const result = await toggleRoom(r, turnedOn, kindFilter);
          totalAffected += result.affected;
        }
        await reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${turnedOn ? "🟢" : "⚫"} Building ${turnedOn ? "On" : "Off"}`)
              .setDescription(`**All rooms** — ${totalAffected} ${kindLabel} turned **${stateArg}**.`)
              .setColor(turnedOn ? BRAND_COLOR : MUTED_COLOR)
              .setTimestamp()
              .setFooter({ text: footer() }),
          ],
        });
      } else {
        // Single room
        const roomParts = lowerArgs.filter((a) => a !== stateArg && a !== "fans" && a !== "fan" && a !== "lights" && a !== "light");
        const q = roomParts.join(" ");
        if (!q) {
          await replyText("Which room? Try `drawing`, `work1`, `work2`, or `all`.");
          return;
        }
        const fullState = await fetchFullState();
        const { label } = findRoomDevices(fullState, q);
        const roomId = q.includes("drawing") ? "drawing_room"
          : q.includes("1") ? "work_room_1"
          : "work_room_2";
        const result = await toggleRoom(roomId, turnedOn, kindFilter);
        await reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(`${turnedOn ? "🟢" : "⚫"} ${kindFilter ? (kindFilter === "fan" ? "Fans" : "Lights") : "Room"} ${turnedOn ? "On" : "Off"}`)
              .setDescription(`**${label}** — ${result.affected} ${kindLabel} turned **${stateArg}**.`)
              .setColor(turnedOn ? BRAND_COLOR : MUTED_COLOR)
              .setTimestamp()
              .setFooter({ text: footer() }),
          ],
        });
      }
      break;
    }

    case "export": {
      const csv = await fetchEventsCsv();
      const attachment = new AttachmentBuilder(Buffer.from(csv, "utf-8"), {
        name: `drishti-events-${new Date().toISOString().slice(0, 10)}.csv`,
      });
      await reply({ content: "📄 Today's device event log — all state changes since midnight:", files: [attachment] });
      break;
    }

    case "ping": {
      const start = Date.now();
      let backendMs = -1;
      try {
        await fetchFullState();
        backendMs = Date.now() - start;
      } catch { /* skip */ }
      await replyText(
        `🏓 **Pong!**\nWS latency: **${client.ws.ping}ms** · Backend: **${backendMs >= 0 ? `${backendMs}ms` : "unreachable"}**`
      );
      break;
    }

    case "help": {
      await reply({ embeds: [buildHelpEmbed()] });
      break;
    }

    case "shutdown": {
      // Enhanced: !shutdown [fans|lights] [room] — granular emergency shutdown
      // Examples: !shutdown, !shutdown fans, !shutdown lights drawing, !shutdown all
      if (!isAdmin) {
        await reply({
          embeds: [new EmbedBuilder()
            .setTitle("❌ Access Denied")
            .setDescription("You need **Administrator** permission to shut down office devices.")
            .setColor(DANGER_COLOR)
          ],
        });
        return;
      }

      // Parse kind and room from args
      const sdArgs = args.map((a) => a.toLowerCase());
      let sdKind: "fan" | "light" | undefined;
      if (sdArgs.includes("fans") || sdArgs.includes("fan")) sdKind = "fan";
      else if (sdArgs.includes("lights") || sdArgs.includes("light")) sdKind = "light";

      // Check for room filter
      const sdRoomParts = sdArgs.filter((a) => !["fans","fan","lights","light","all","off"].includes(a));
      let sdRoom: string | undefined;
      if (sdRoomParts.length > 0) {
        const q = sdRoomParts.join(" ");
        sdRoom = q.includes("drawing") ? "drawing_room"
          : q.includes("1") ? "work_room_1"
          : q.includes("2") ? "work_room_2"
          : undefined;
      }

      const sdKindLabel = sdKind === "fan" ? "fan(s)" : sdKind === "light" ? "light(s)" : "device(s)";
      const sdScopeLabel = sdRoom ? (ROOM_LABELS[sdRoom] ?? sdRoom) : "entire building";

      const state = await fetchFullState();
      let relevantDevices = state.devices.filter((d) => d.isOn);
      if (sdKind) relevantDevices = relevantDevices.filter((d) => d.kind === sdKind);
      if (sdRoom) relevantDevices = relevantDevices.filter((d) => d.room === sdRoom);

      if (relevantDevices.length === 0) {
        await reply({ embeds: [new EmbedBuilder().setDescription(`✅ No matching ${sdKindLabel} currently on in ${sdScopeLabel}.`).setColor(SUCCESS_COLOR)] });
        return;
      }

      await replyText(`⚠️ Confirm: shut down **${relevantDevices.length}** ${sdKindLabel} in **${sdScopeLabel}**? React within 15s.`);
      // Button flow handled separately in prefix/slash handlers below
      break;
    }

    default:
      break;
  }
}

// ── Prefix command handler ───────────────────────────────────────────────────

client.on("messageCreate", async (message) => {
  if (message.author.bot || !message.content.startsWith(PREFIX)) return;
  const [rawCmd, ...args] = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = rawCmd.toLowerCase();
  const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator) ?? false;

  // Special-case shutdown for prefix (needs button interaction)
  if (cmd === "shutdown") {
    if (!isAdmin) {
      await message.reply({ embeds: [new EmbedBuilder().setTitle("❌ Access Denied").setDescription("Administrator permission required.").setColor(DANGER_COLOR)] });
      return;
    }

    // Parse kind and room from prefix args
    const sdArgs = args.map((a) => a.toLowerCase());
    let sdKind: "fan" | "light" | undefined;
    if (sdArgs.includes("fans") || sdArgs.includes("fan")) sdKind = "fan";
    else if (sdArgs.includes("lights") || sdArgs.includes("light")) sdKind = "light";

    const sdRoomParts = sdArgs.filter((a) => !["fans","fan","lights","light","all","off"].includes(a));
    let sdRoom: string | undefined;
    if (sdRoomParts.length > 0) {
      const rq = sdRoomParts.join(" ");
      sdRoom = rq.includes("drawing") ? "drawing_room"
        : rq.includes("1") ? "work_room_1"
        : rq.includes("2") ? "work_room_2"
        : undefined;
    }

    const sdKindLabel = sdKind === "fan" ? "fan(s)" : sdKind === "light" ? "light(s)" : "device(s)";
    const sdScopeLabel = sdRoom ? (ROOM_LABELS[sdRoom] ?? sdRoom) : "entire building";

    const state = await fetchFullState();
    let relevantDevices = state.devices.filter((d) => d.isOn);
    if (sdKind) relevantDevices = relevantDevices.filter((d) => d.kind === sdKind);
    if (sdRoom) relevantDevices = relevantDevices.filter((d) => d.room === sdRoom);
    const onCount = relevantDevices.length;

    if (onCount === 0) {
      await message.reply({ embeds: [new EmbedBuilder().setDescription(`✅ No matching ${sdKindLabel} currently on in ${sdScopeLabel}.`).setColor(SUCCESS_COLOR)] });
      return;
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("sd_yes").setLabel(`Shut down ${onCount} ${sdKindLabel}`).setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("sd_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    );
    const confirmMsg = await message.reply({
      embeds: [new EmbedBuilder().setTitle("⚠️ Confirm Shutdown").setDescription(`Turn off **${onCount}** ${sdKindLabel} in **${sdScopeLabel}**?`).setColor(WARN_COLOR)],
      components: [row],
    });
    try {
      const btn = await confirmMsg.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 15_000,
        filter: (i) => i.user.id === message.author.id,
      });
      if (btn.customId === "sd_yes") {
        const result = await shutdownAllDevices(sdKind, sdRoom);
        await btn.update({ embeds: [new EmbedBuilder().setTitle("🔌 Shutdown Complete").setDescription(`**${result.shutDown}** ${sdKindLabel} off in ${sdScopeLabel}. By ${message.author.username}.`).setColor(SUCCESS_COLOR)], components: [] });
      } else {
        await btn.update({ embeds: [new EmbedBuilder().setDescription("Shutdown cancelled.").setColor(MUTED_COLOR)], components: [] });
      }
    } catch {
      await confirmMsg.edit({ embeds: [new EmbedBuilder().setDescription("Timed out — no action taken.").setColor(MUTED_COLOR)], components: [] });
    }
    return;
  }

  try {
    await handleCommand(
      cmd, args,
      (opts) => message.reply(opts as Parameters<typeof message.reply>[0]).then(() => {}),
      (opts) => message.reply(opts as Parameters<typeof message.reply>[0]).then(() => {}),
      message.author.id,
      isAdmin,
    );
  } catch (err) {
    console.error(`[bot] prefix !${cmd} error:`, err);
    await message.reply("⚠️ Couldn't reach the office backend — is the server running?").catch(() => {});
  }
});

// ── Slash command handler ────────────────────────────────────────────────────

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;

  try {
    await interaction.deferReply();
    const isAdmin = interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator) ?? false;
    const args: string[] = [];

    // Extract slash args
    if (cmd === "room")  args.push(interaction.options.getString("name", true));
    if (cmd === "turn") {
      args.push(interaction.options.getString("room", true));
      const kindOpt = interaction.options.getString("kind");
      if (kindOpt && kindOpt !== "all") args.push(kindOpt === "fan" ? "fans" : "lights");
      args.push(interaction.options.getString("state", true));
    }

    if (cmd === "shutdown") {
      if (!isAdmin) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setTitle("❌ Access Denied").setDescription("Administrator permission required.").setColor(DANGER_COLOR)] });
        return;
      }

      // Parse granular options
      const kindOpt = interaction.options.getString("kind");
      const roomOpt = interaction.options.getString("room");
      const sdKind: "fan" | "light" | undefined = (kindOpt === "fan" || kindOpt === "light") ? kindOpt : undefined;
      const sdRoom: string | undefined = roomOpt ?? undefined;
      const sdKindLabel = sdKind === "fan" ? "fan(s)" : sdKind === "light" ? "light(s)" : "device(s)";
      const sdScopeLabel = sdRoom ? (ROOM_LABELS[sdRoom] ?? sdRoom) : "entire building";

      const state = await fetchFullState();
      let relevantDevices = state.devices.filter((d) => d.isOn);
      if (sdKind) relevantDevices = relevantDevices.filter((d) => d.kind === sdKind);
      if (sdRoom) relevantDevices = relevantDevices.filter((d) => d.room === sdRoom);
      const onCount = relevantDevices.length;

      if (onCount === 0) {
        await interaction.editReply({ embeds: [new EmbedBuilder().setDescription(`✅ No matching ${sdKindLabel} currently on in ${sdScopeLabel}.`).setColor(SUCCESS_COLOR)] });
        return;
      }
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId("sd_yes").setLabel(`Shut down ${onCount} ${sdKindLabel}`).setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("sd_no").setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      );
      const msg = await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("⚠️ Confirm Shutdown").setDescription(`Turn off **${onCount}** ${sdKindLabel} in **${sdScopeLabel}**?`).setColor(WARN_COLOR)],
        components: [row],
      });
      try {
        const btn = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 15_000, filter: (i) => i.user.id === interaction.user.id });
        if (btn.customId === "sd_yes") {
          const result = await shutdownAllDevices(sdKind, sdRoom);
          await btn.update({ embeds: [new EmbedBuilder().setTitle("🔌 Shutdown Complete").setDescription(`**${result.shutDown}** ${sdKindLabel} off in ${sdScopeLabel}.`).setColor(SUCCESS_COLOR)], components: [] });
        } else {
          await btn.update({ embeds: [new EmbedBuilder().setDescription("Cancelled.").setColor(MUTED_COLOR)], components: [] });
        }
      } catch {
        await interaction.editReply({ embeds: [new EmbedBuilder().setDescription("Timed out.").setColor(MUTED_COLOR)], components: [] });
      }
      return;
    }

    await handleCommand(
      cmd, args,
      (opts) => interaction.editReply(opts).then(() => {}),
      (opts) => interaction.editReply(opts).then(() => {}),
      interaction.user.id,
      isAdmin,
    );
  } catch (err) {
    console.error(`[bot] slash /${cmd} error:`, err);
    const msg = "⚠️ Couldn't reach the office backend — is the server running?";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(msg).catch(() => {});
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => {});
    }
  }
});

// ── Proactive alert polling ──────────────────────────────────────────────────

async function pollForNewAlerts(): Promise<void> {
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!channelId) return;

  try {
    const state = await fetchFullState();
    const fresh = state.alerts.filter((a) => !knownAlertIds.has(a.id));
    for (const a of state.alerts) knownAlertIds.add(a.id);
    if (fresh.length === 0) return;

    const channel = await client.channels.fetch(channelId) as TextChannel;
    if (!channel?.isTextBased()) return;

    for (const alert of fresh) {
      const ctx = `Alert: ${alert.message} | Room: ${ROOM_LABELS[alert.room] ?? alert.room} | Severity: ${alert.severity} | Type: ${alert.type.replace(/_/g, " ")}`;
      const result = await generateWithFallback(
        `Write ONE urgent but friendly Discord message (max 2 sentences) about this office alert. No markdown headers.`,
        () => alertAnnouncementTemplate(alert.message, alert.severity as AlertSeverity),
        ctx
      );

      const embed = new EmbedBuilder()
        .setTitle(`${ALERT_EMOJI[alert.severity]} ${alert.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}`)
        .setDescription(result.text)
        .setColor(ALERT_COLORS[alert.severity])
        .addFields(
          { name: "Room",     value: ROOM_LABELS[alert.room] ?? alert.room, inline: true },
          { name: "Severity", value: alert.severity.charAt(0).toUpperCase() + alert.severity.slice(1), inline: true },
          { name: "Time",     value: new Date(alert.createdAt).toLocaleTimeString("en-BD", { hour: "2-digit", minute: "2-digit" }), inline: true },
        )
        .setFooter({ text: `Drishti Alert · AI: ${result.provider}` })
        .setTimestamp(new Date(alert.createdAt));

      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error("[bot] alert poll error:", (err as Error).message);
  }
}

// ── Startup ──────────────────────────────────────────────────────────────────

client.once("ready", async () => {
  console.log(`\n  [bot] ✓ Logged in as ${client.user?.tag}`);
  console.log(`  [bot] ✓ Serving ${client.guilds.cache.size} guild(s)`);
  console.log(`  [bot] ✓ Alert polling every ${POLL_INTERVAL_MS / 1000}s`);
  console.log(`  [bot] LLM providers: Groq=${Boolean(process.env.GROQ_API_KEY)} Gemini=${Boolean(process.env.GEMINI_API_KEY)} OpenRouter=${Boolean(process.env.OPENROUTER_API_KEY)}\n`);

  client.user?.setActivity("the office ⚡", { type: ActivityType.Watching });
  await registerSlashCommands();
  setInterval(pollForNewAlerts, POLL_INTERVAL_MS);
});

if (!process.env.DISCORD_BOT_TOKEN) {
  console.warn("[bot] DISCORD_BOT_TOKEN not set — bot will not connect. Set it in backend/.env");
  console.warn("[bot] All other functionality (backend, dashboard) works without a token.\n");
} else {
  client.login(process.env.DISCORD_BOT_TOKEN);
}
