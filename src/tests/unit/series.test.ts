import { describe, expect, it } from "vitest";
import { dedupeNodeKey, sameSeries, seriesKeyOf } from "../../graph/series.js";

describe("recurring-series derivation", () => {
  it("seriesKeyOf strips a full instance suffix to the series stem", () => {
    expect(seriesKeyOf({ source: "calendar", externalId: "huddle1_20260511T150000Z" })).toBe(
      "huddle1",
    );
    expect(seriesKeyOf({ source: "calendar", externalId: "x_20260511" })).toBe("x");
    expect(seriesKeyOf({ source: "calendar", externalId: "x_20260511T1500" })).toBe("x");
  });

  it("seriesKeyOf is undefined for one-off calendar events (no recurrence suffix)", () => {
    expect(seriesKeyOf({ source: "calendar", externalId: "evt_apollo_review" })).toBeUndefined();
    expect(seriesKeyOf({ source: "calendar", externalId: "ext_s5" })).toBeUndefined();
  });

  it("seriesKeyOf is undefined for non-calendar sources even with a suffix-shaped id", () => {
    expect(seriesKeyOf({ source: "email", externalId: "mail_20260511T150000Z" })).toBeUndefined();
    expect(seriesKeyOf({ source: "slack", externalId: "C1/p_20260511" })).toBeUndefined();
  });

  it("sameSeries requires both sides to resolve to the SAME stem", () => {
    const a = { source: "calendar", externalId: "huddle_20260511T150000Z" } as const;
    const b = { source: "calendar", externalId: "huddle_20260512T150000Z" } as const;
    const c = { source: "calendar", externalId: "retro_20260512T150000Z" } as const;
    const oneOff = { source: "calendar", externalId: "evt_oneoff" } as const;
    expect(sameSeries(a, b)).toBe(true);
    expect(sameSeries(a, c)).toBe(false);
    // Two undefined keys must NOT count as the same series.
    expect(sameSeries(oneOff, oneOff)).toBe(false);
  });

  it("dedupeNodeKey collapses instances to one logical series node", () => {
    expect(
      dedupeNodeKey({ id: "s1", source: "calendar", externalId: "huddle_20260511T150000Z" }),
    ).toBe("series:huddle");
    expect(dedupeNodeKey({ id: "s2", source: "email", externalId: "mail_1" })).toBe("sig:s2");
  });
});
