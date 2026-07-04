import { deviceStore } from "./store";
import { ROOM_IDS, RoomId } from "@drishti/shared";

/**
 * Believable, time-of-day-aware device simulation.
 *
 * Patterns simulated:
 *  - Morning ramp-up (8-9AM): devices turning on as people arrive
 *  - Core office hours (9AM-12PM): high activity
 *  - Lunch break (12-1PM): moderate drop — people leave rooms
 *  - Post-lunch (1-4PM): back to full office activity
 *  - Wind-down (4-5PM): gradual shutdowns as people leave early
 *  - After-hours (5-8PM): most off, occasional "forgot" devices
 *  - Night (8PM-8AM): almost everything off, rare phantom load
 *  - Weekend: minimal activity
 *
 * Occupancy is loosely correlated with device activity, with a deliberate
 * ~6% mismatch rate to exercise the occupancy-mismatch alert consistently.
 */

function isWeekday(date: Date): boolean {
  const day = date.getDay();
  return day >= 0 && day <= 4; // Sun-Thu = Bangladesh work week
}

function getActivityBias(hour: number, weekday: boolean): number {
  if (!weekday) return 0.05;
  if (hour >= 8 && hour < 9)   return 0.45; // morning ramp-up
  if (hour >= 9 && hour < 12)  return 0.82; // core hours
  if (hour === 12)              return 0.50; // lunch dip
  if (hour === 13)              return 0.55; // still lunch, coming back
  if (hour >= 14 && hour < 16) return 0.80; // post-lunch productivity
  if (hour >= 16 && hour < 17) return 0.60; // wind-down
  if (hour >= 17 && hour < 19) return 0.25; // early evening stragglers
  if (hour >= 19 && hour < 21) return 0.10; // late-evening: a few forgotten
  return 0.04;                               // deep night: almost off
}

function getFanBias(hour: number, weekday: boolean): number {
  const base = getActivityBias(hour, weekday);
  // Fans tend to follow people closely
  return base;
}

function getLightBias(hour: number, weekday: boolean): number {
  const base = getActivityBias(hour, weekday);
  // Lights stay on more than fans (people leave lights on)
  return Math.min(1, base * 1.08);
}

let intervalHandle: NodeJS.Timeout | null = null;

export function startSimulatorLoop(onTick: () => void, intervalMs = 8000): void {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    tick();
    onTick();
  }, intervalMs);
}

export function stopSimulatorLoop(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

function tick(): void {
  const now = new Date();
  const hour = deviceStore.getVirtualHour();
  const weekday = isWeekday(now);

  const devices = deviceStore.getAllDevices();

  // Sample ~20% of devices per tick — feels like actual people flipping switches
  const sampleSize = Math.max(1, Math.floor(devices.length * 0.20));
  const shuffled = [...devices].sort(() => Math.random() - 0.5).slice(0, sampleSize);

  for (const device of shuffled) {
    const bias = device.kind === "fan"
      ? getFanBias(hour, weekday)
      : getLightBias(hour, weekday);

    // Add small per-device random drift so not all devices in same room behave identically
    const jitteredBias = Math.max(0, Math.min(1, bias + (Math.random() - 0.5) * 0.12));
    const shouldBeOn = Math.random() < jitteredBias;

    if (shouldBeOn !== device.isOn) {
      deviceStore.setDeviceState(device.id, shouldBeOn);
    }
  }

  // Occupancy: loosely correlated with room device activity
  // Deliberate ~6% mismatch rate to exercise the occupancy-mismatch alert
  for (const room of ROOM_IDS) {
    const roomDevices = devices.filter((d) => d.room === room);
    const anyOn = roomDevices.some((d) => d.isOn);
    const activityLevel = getActivityBias(hour, weekday);

    // During lunch, occupancy drops even if some lights are on
    const lunchModifier = (hour === 12 || hour === 13) ? 0.6 : 1;
    const occupancyChance = anyOn ? activityLevel * lunchModifier * 0.85 : 0.05;
    const deliberateMismatch = Math.random() < 0.06;
    const occupied = deliberateMismatch ? false : Math.random() < occupancyChance;

    deviceStore.setOccupancy(room as RoomId, occupied);
  }
}

/**
 * Seeds a realistic history on boot so charts have meaningful data
 * from the start of the current day, not just from boot time.
 * Uses time-of-day-appropriate patterns for each historical bucket.
 */
export function seedHistory(): void {
  const devices = deviceStore.getAllDevices();
  const now = Date.now();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Seed events every 30 minutes from midnight to now
  const currentHour = new Date().getHours();
  const buckets = currentHour * 2 + Math.floor(new Date().getMinutes() / 30);

  for (let bucket = 0; bucket <= buckets; bucket++) {
    const bucketTime = startOfDay.getTime() + bucket * 30 * 60 * 1000;
    const bucketHour = Math.floor(bucket / 2);
    const bias = getActivityBias(bucketHour, true); // assume weekday for seeding

    // Add some variance around each bucket
    const jitter = Math.random() * 8 * 60 * 1000; // ±8 min jitter
    const timestamp = new Date(bucketTime + jitter).toISOString();

    // Pick a subset of devices and set their state for this point in time
    const subset = [...devices].sort(() => Math.random() - 0.5).slice(0, Math.ceil(devices.length * 0.4));
    for (const device of subset) {
      const deviceBias = device.kind === "fan" ? bias : Math.min(1, bias * 1.08);
      const shouldBeOn = Math.random() < deviceBias;
      if (shouldBeOn !== device.isOn) {
        deviceStore.setDeviceState(device.id, shouldBeOn, timestamp);
      }
    }
  }

  // Also add 1-2 recent flips per device in the last hour for realistic chart tail.
  // Keep flips spread out (>10 min apart per device) to avoid triggering phantom_load
  // alerts (which fire on 3+ flips within 5 min) on boot.
  for (const device of devices) {
    const flips = 1 + Math.floor(Math.random() * 2); // 1 or 2 flips only
    for (let i = flips; i >= 1; i--) {
      const minutesAgo = i * 25 + Math.random() * 15; // spread 25+ min apart
      const ts = new Date(now - minutesAgo * 60000).toISOString();
      deviceStore.setDeviceState(device.id, i % 2 === 0, ts);
    }
  }
}
