import { AlertSeverity, ROOM_IDS, ROOM_LABELS, RoomId, RoomEfficiency, EfficiencyGrade } from "@drishti/shared";
import { getAlertHistorySince } from "./alertEngine";

/**
 * Room Efficiency Score — reduces each room's anomaly track record for
 * "today" into a single 0-100 score and A-F grade. This is deliberately
 * NOT derived from the currently-active alert snapshot: a room that
 * triggered a critical continuous-run alert at 2AM and then got fixed by
 * 9AM should still show a worse score than a room with a spotless night,
 * even though both show zero *active* alerts by the time anyone looks.
 * The score is a track record, not a current-instant reading.
 */

const SEVERITY_PENALTY: Record<AlertSeverity, number> = {
  info: 2,
  warning: 5,
  critical: 12,
};

function gradeFromScore(score: number): EfficiencyGrade {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 55) return "C";
  if (score >= 35) return "D";
  return "F";
}

export function computeEfficiencyLeaderboard(): RoomEfficiency[] {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const history = getAlertHistorySince(startOfDay.toISOString());

  return ROOM_IDS.map((room) => {
    const roomAlerts = history.filter((a) => a.room === room);
    const penalty = roomAlerts.reduce((sum, a) => sum + SEVERITY_PENALTY[a.severity], 0);
    const score = Math.max(0, Math.min(100, 100 - penalty));
    return {
      room,
      label: ROOM_LABELS[room],
      score,
      grade: gradeFromScore(score),
      incidentsToday: roomAlerts.length,
    };
  }).sort((a, b) => b.score - a.score);
}
