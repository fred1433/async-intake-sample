/**
 * Caps on live runs, so a page left open or found by a crawler does not run the
 * models in a loop.
 *
 * What they are: two counters in the memory of one server process, the whole
 * instance first, then the address, both reset at the start of the UTC day.
 * What they are not: the spending guarantee. A restart starts the count again
 * and a second instance keeps its own. The durable limit is the monthly spend
 * limit set on the provider workspace this deployment calls, declared in
 * DEMO_SPEND_LIMIT_USD; without it, live runs are switched off.
 */
export const LIMIT_SCOPE = "process" as const;

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
  reason?: "instance_daily_cap" | "address_daily_cap";
  instanceRemaining: number;
  addressRemaining: number;
  resetsAt: string;
}

interface Counters {
  day: string;
  instance: number;
  perAddress: Map<string, number>;
}

const counters: Counters = { day: "", instance: 0, perAddress: new Map() };

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
  return {
    allowed: counters.instance < instanceDailyLimit() && used < addressDailyLimit(),
    instanceRemaining: Math.max(0, instanceDailyLimit() - counters.instance),
    addressRemaining: Math.max(0, addressDailyLimit() - used),
    resetsAt: nextMidnightUtc(now),
  };
}

/** Spends one live run if both caps allow it. */
export function takeLiveRun(clientId: string, now: Date = new Date()): LimitDecision {
  rollOver(now);
  const used = counters.perAddress.get(clientId) ?? 0;
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
}
