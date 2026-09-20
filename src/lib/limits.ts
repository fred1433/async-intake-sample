/**
 * Caps on live runs, so a page left open or found by a crawler does not run the
 * models in a loop.
 *
 * What they are: two counters in the memory of one server process, the whole
 * instance first, then the address, both reset at the start of the UTC day,
 * taken before the first of the two model calls, so one count bounds both
 * providers. And a breaker: after three consecutive provider failures, live
 * runs pause for thirty minutes without calling anything, so a persistent
 * error is not repeated forty times.
 * What they are not: the spending guarantee. A restart starts the count again
 * and a second instance keeps its own. The durable limit is the monthly spend
 * limit set on the provider workspace this deployment calls, declared in
 * DEMO_SPEND_LIMIT_USD; without it, live runs are switched off. The
 * transcription provider has no such limit here: it is bounded by the same
 * daily count, by the transcript cache of the pipeline, and by this breaker.
 */
export const LIMIT_SCOPE = "process" as const;

export const BREAKER_FAILURES = 3;
export const BREAKER_PAUSE_MS = 30 * 60 * 1000;

export function instanceDailyLimit(): number {
  const raw = Number(process.env.DEMO_DAILY_CAP ?? "40");
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 40;
}

export function addressDailyLimit(): number {
  const raw = Number(process.env.DEMO_ADDRESS_DAILY_CAP ?? "5");
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 5;
}

export interface LimitDecision {
  allowed: boolean;
  reason?: "instance_daily_cap" | "address_daily_cap" | "paused_after_errors";
  instanceRemaining: number;
  addressRemaining: number;
  resetsAt: string;
  /** Set while the breaker is open. */
  pausedUntil: string | null;
}

interface Counters {
  day: string;
  instance: number;
  perAddress: Map<string, number>;
}

const counters: Counters = { day: "", instance: 0, perAddress: new Map() };
const breaker = { failures: 0, pausedUntil: 0 };

/** A provider did not answer: one more failure; the third in a row opens the breaker. */
export function recordProviderFailure(now: Date = new Date()): void {
  breaker.failures += 1;
  if (breaker.failures >= BREAKER_FAILURES) breaker.pausedUntil = now.getTime() + BREAKER_PAUSE_MS;
}

/** A run came back: the failures in a row are forgotten. */
export function recordProviderSuccess(): void {
  breaker.failures = 0;
  breaker.pausedUntil = 0;
}

export function pausedUntil(now: Date = new Date()): string | null {
  if (breaker.pausedUntil > now.getTime()) return new Date(breaker.pausedUntil).toISOString();
  if (breaker.pausedUntil !== 0) {
    // The pause is over: start counting again from zero.
    breaker.pausedUntil = 0;
    breaker.failures = 0;
  }
  return null;
}

const dayOf = (now: Date) => now.toISOString().slice(0, 10);

function nextMidnightUtc(now: Date): string {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.toISOString();
}

function rollOver(now: Date): void {
  const today = dayOf(now);
  if (counters.day !== today) {
    counters.day = today;
    counters.instance = 0;
    counters.perAddress = new Map();
  }
}

/** Reads the counters without spending anything. */
export function inspect(now: Date = new Date(), clientId = "unknown"): LimitDecision {
  rollOver(now);
  const used = counters.perAddress.get(clientId) ?? 0;
  const paused = pausedUntil(now);
  return {
    allowed: !paused && counters.instance < instanceDailyLimit() && used < addressDailyLimit(),
    instanceRemaining: Math.max(0, instanceDailyLimit() - counters.instance),
    addressRemaining: Math.max(0, addressDailyLimit() - used),
    resetsAt: nextMidnightUtc(now),
    pausedUntil: paused,
  };
}

/** Spends one live run if the breaker is closed and both caps allow it. Taken before any provider is called. */
export function takeLiveRun(clientId: string, now: Date = new Date()): LimitDecision {
  rollOver(now);
  const used = counters.perAddress.get(clientId) ?? 0;
  if (pausedUntil(now)) {
    return { ...inspect(now, clientId), allowed: false, reason: "paused_after_errors" };
  }
  if (counters.instance >= instanceDailyLimit()) {
    return { ...inspect(now, clientId), allowed: false, reason: "instance_daily_cap" };
  }
  if (used >= addressDailyLimit()) {
    return { ...inspect(now, clientId), allowed: false, reason: "address_daily_cap" };
  }
  counters.instance += 1;
  counters.perAddress.set(clientId, used + 1);
  return { ...inspect(now, clientId), allowed: true };
}

/** Tests only, and the shape a process restart has from the outside. */
export function resetLimits(): void {
  counters.day = "";
  counters.instance = 0;
  counters.perAddress = new Map();
  breaker.failures = 0;
  breaker.pausedUntil = 0;
}
