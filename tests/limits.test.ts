import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspect, resetLimits, takeLiveRun } from "../src/lib/limits";

describe("daily caps on live runs", () => {
  beforeEach(() => {
    resetLimits();
    process.env.DEMO_DAILY_CAP = "2";
    process.env.DEMO_ADDRESS_DAILY_CAP = "1";
  });
  afterEach(() => {
    delete process.env.DEMO_DAILY_CAP;
    delete process.env.DEMO_ADDRESS_DAILY_CAP;
    resetLimits();
  });

  it("allows up to the instance cap, then refuses with the reason", () => {
    const day = new Date("2026-09-20T10:00:00Z");
    expect(takeLiveRun("a", day).allowed).toBe(true);
    expect(takeLiveRun("b", day).allowed).toBe(true);
    const third = takeLiveRun("c", day);
    expect(third.allowed).toBe(false);
    expect(third.reason).toBe("instance_daily_cap");
    expect(third.instanceRemaining).toBe(0);
  });

  it("caps one address before the instance", () => {
    const day = new Date("2026-09-20T10:00:00Z");
    expect(takeLiveRun("a", day).allowed).toBe(true);
    const again = takeLiveRun("a", day);
    expect(again.allowed).toBe(false);
    expect(again.reason).toBe("address_daily_cap");
    expect(inspect(day, "b").allowed).toBe(true);
  });

  it("starts again at midnight UTC", () => {
    const day = new Date("2026-09-20T23:59:00Z");
    takeLiveRun("a", day);
    takeLiveRun("b", day);
    expect(takeLiveRun("c", day).allowed).toBe(false);
    const next = new Date("2026-09-21T00:01:00Z");
    expect(inspect(next, "c").resetsAt).toBe("2026-09-22T00:00:00.000Z");
    expect(takeLiveRun("c", next).allowed).toBe(true);
  });

  it("reads the cap from the environment, so a test deployment can set it to 1", () => {
    process.env.DEMO_DAILY_CAP = "1";
    const day = new Date("2026-09-20T10:00:00Z");
    expect(takeLiveRun("a", day).allowed).toBe(true);
    expect(takeLiveRun("b", day).allowed).toBe(false);
  });
});
