import { describe, expect, it } from "vitest";
import { reextractAll, reextractSignal } from "../../extraction/backfill.js";
import type { Signal } from "../../artifacts/Signal.js";

const USERS = new Map([["U076FDG8K9B", "Ali Zaidi <ali@phi.consulting>"]]);

function sig(partial: Partial<Signal>): Signal {
  return {
    id: "sig_1",
    source: "slack",
    externalId: "C1:1.0",
    actorIds: [],
    timestamp: "2026-06-09T12:00:00.000Z",
    excerpt: "",
    extracted: {
      entities: [],
      people: [],
      projects: [],
      dates: [],
      artifacts: [],
      asks: [],
      decisions: [],
    },
    provenance: { ingestedBy: "test", ingestedAt: "2026-06-09T12:00:00.000Z", sourceHash: "h" },
    ...partial,
  };
}

describe("reextractSignal", () => {
  it("resolves slack actors, cleans markup, and fills extracted fields", () => {
    const original = sig({
      actorIds: ["U076FDG8K9B"],
      excerpt:
        "Kick off for Tentrucks <@U076FDG8K9B> can you check <http://signalhire.com|signalhire.com>?",
    });
    const { signal, changed } = reextractSignal(original, USERS);
    expect(changed).toBe(true);
    expect(signal.actorIds).toEqual(["Ali Zaidi <ali@phi.consulting>"]);
    expect(signal.excerpt).toContain("@Ali Zaidi");
    expect(signal.excerpt).not.toContain("<@");
    expect(signal.extracted.people).toContain("Ali Zaidi <ali@phi.consulting>");
    expect(signal.extracted.artifacts).toEqual(["http://signalhire.com"]);
    expect(signal.extracted.entities).toContain("Tentrucks");
    expect(signal.extracted.asks.length).toBeGreaterThan(0);
  });

  it("is idempotent", () => {
    const original = sig({
      actorIds: ["U076FDG8K9B"],
      excerpt: "Kick off for Tentrucks <@U076FDG8K9B> please review",
    });
    const first = reextractSignal(original, USERS).signal;
    const second = reextractSignal(first, USERS);
    expect(second.changed).toBe(false);
  });

  it("keeps existing extracted values (additive merge)", () => {
    const original = sig({
      source: "email",
      excerpt: "see Apollo notes",
      extracted: {
        entities: ["Legacy Entity"],
        people: [],
        projects: ["apollo"],
        dates: [],
        artifacts: [],
        asks: [],
        decisions: [],
      },
    });
    const { signal } = reextractSignal(original);
    expect(signal.extracted.entities).toContain("Legacy Entity");
    expect(signal.extracted.entities).toContain("Apollo");
    expect(signal.extracted.projects).toEqual(["apollo"]);
  });
});

describe("reextractAll", () => {
  it("reports coverage and resolution stats", () => {
    const signals = [
      sig({ id: "sig_1", actorIds: ["U076FDG8K9B"], excerpt: "Tentrucks update from <@U076FDG8K9B>" }),
      sig({ id: "sig_2", source: "calendar", excerpt: "Daily Huddle" , title: "Daily Huddle"}),
    ];
    const { signals: out, stats } = reextractAll(signals, USERS);
    expect(stats.total).toBe(2);
    expect(stats.withFactsBefore).toBe(0);
    expect(stats.withFactsAfter).toBe(2);
    expect(stats.actorsResolved).toBe(1);
    expect(out[0]!.actorIds[0]).toBe("Ali Zaidi <ali@phi.consulting>");
  });
});
