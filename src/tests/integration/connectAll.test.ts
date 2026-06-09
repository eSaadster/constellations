import { describe, expect, it } from "vitest";
import { createConstellationRuntime } from "../../agent/runtime.js";
import { createLogger, setLogger } from "../../observability/logger.js";
import { IdGenerator, fixedClock } from "../../util/ids.js";

setLogger(createLogger({ level: "silent" }));

function freshRuntime() {
  return createConstellationRuntime({
    ids: new IdGenerator("t"),
    clock: fixedClock("2026-03-01T00:00:00.000Z"),
  });
}

/** Unordered (source,target) pair + relation — the dedupe identity. */
function pairKey(l: { sourceSignalId: string; targetSignalId: string; relation: string }): string {
  return `${[l.sourceSignalId, l.targetSignalId].sort().join("::")}|${l.relation}`;
}

describe("connect-all: connect every signal in one pass", () => {
  it("anchors every ingested signal and builds at least one constellation", async () => {
    const rt = freshRuntime();
    const { signalCount } = await rt.ingestFixtures();
    const result = await rt.connectAll({ dedupe: false });

    expect(result.anchors).toBe(signalCount);
    expect(result.links).toBeGreaterThan(0);
    expect(result.constellations).toBeGreaterThanOrEqual(1);
    // Without dedupe, the store may hold reverse-duplicate links.
    expect(result.duplicatesRemoved).toBe(0);
  });

  it("with --dedupe leaves no duplicate (pair + relation) links", async () => {
    const rt = freshRuntime();
    await rt.ingestFixtures();
    const result = await rt.connectAll({ dedupe: true });

    const links = rt.store.listLinks();
    const keys = links.map(pairKey);
    // Every surviving link is unique by pair + relation.
    expect(new Set(keys).size).toBe(links.length);
    expect(result.links).toBe(links.length);
  });

  it("dedupe removes the reverse-duplicates a non-dedupe pass keeps", async () => {
    const withDup = await (async () => {
      const rt = freshRuntime();
      await rt.ingestFixtures();
      return rt.connectAll({ dedupe: false });
    })();
    const deduped = await (async () => {
      const rt = freshRuntime();
      await rt.ingestFixtures();
      return rt.connectAll({ dedupe: true });
    })();

    // Anchoring both A and B surfaces the same pair twice; dedupe collapses it.
    expect(deduped.duplicatesRemoved).toBeGreaterThan(0);
    expect(deduped.links).toBeLessThan(withDup.links);
    expect(deduped.links).toBe(withDup.links - deduped.duplicatesRemoved);
  });
});
