import { describe, expect, it } from "vitest";
import { callouts, pickCallout, renderCallout } from "../src/callouts.js";

// A small deterministic PRNG (mulberry32) so the no-repeat test is seeded.
function seededRng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("callouts", () => {
  it("has at least 15 distinct templates", () => {
    expect(callouts.length).toBeGreaterThanOrEqual(15);
    expect(new Set(callouts).size).toBe(callouts.length);
  });

  it.each(callouts)("renders %j with the poster's mention", (template) => {
    const text = renderCallout(template, "UPOSTER");
    expect(text).toContain("<@UPOSTER>");
    expect(text).not.toContain("{user}");
    expect(text).not.toMatch(/[{}]/);
  });
});

describe("pickCallout", () => {
  it("never returns the same line twice in a row for a channel", () => {
    const rng = seededRng(42);
    let previous = pickCallout("CNOREPEAT", rng);
    const seen = new Set([previous]);
    for (let i = 0; i < 1000; i++) {
      const next = pickCallout("CNOREPEAT", rng);
      expect(next).not.toBe(previous);
      seen.add(next);
      previous = next;
    }
    // Still a random choice over every template, not a fixed alternation.
    expect(seen.size).toBe(callouts.length);
  });

  it("skips the last line even when the rng keeps pointing at it", () => {
    const first = pickCallout("CSTUCK", () => 0);
    const second = pickCallout("CSTUCK", () => 0);
    expect(first).toBe(callouts[0]);
    expect(second).not.toBe(first);
  });

  it("tracks the last line per channel", () => {
    pickCallout("CONE", () => 0);
    expect(pickCallout("CTWO", () => 0)).toBe(callouts[0]);
  });

  it("stays in range when the rng returns its upper bound", () => {
    expect(callouts).toContain(pickCallout("CEDGE", () => 0.9999999999));
    expect(callouts).toContain(pickCallout("CEDGE", () => 1));
  });
});
