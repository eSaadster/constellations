import { describe, expect, it } from "vitest";
import { createConstellationRuntime } from "../../agent/runtime.js";
import { MemoryGraphStore } from "../../graph/memoryStore.js";
import { createLogger, setLogger } from "../../observability/logger.js";
import { IdGenerator, fixedClock } from "../../util/ids.js";

setLogger(createLogger({ level: "silent" }));

describe("re-ingest is incremental, never clobbering", () => {
  it("skips already-known items on a second ingest in the same process", async () => {
    const rt = createConstellationRuntime({
      ids: new IdGenerator("t"),
      clock: fixedClock("2026-03-01T00:00:00.000Z"),
    });
    const first = await rt.ingestFixtures();
    expect(first.signalCount).toBeGreaterThan(0);
    expect(first.skipped).toBe(0);

    const second = await rt.ingestFixtures();
    expect(second.signalCount).toBe(0);
    expect(second.skipped).toBe(first.signalCount);
    expect(rt.store.listSignals().length).toBe(first.signalCount);
  });

  it("a fresh process (new runtime, seeded ids) does not overwrite persisted signals", async () => {
    // Process 1: ingest into a shared store.
    const store = new MemoryGraphStore();
    const rt1 = createConstellationRuntime({
      store,
      ids: new IdGenerator(),
      clock: fixedClock("2026-03-01T00:00:00.000Z"),
    });
    const first = await rt1.ingestFixtures();
    const before = new Map(store.listSignals().map((s) => [s.id, s.excerpt]));

    // Process 2: same store (as if reloaded from disk), fresh id counter seeded
    // from existing ids — the CLI's buildRuntime behavior.
    const ids = new IdGenerator();
    ids.seedFromIds(store.listSignals().map((s) => s.id));
    const rt2 = createConstellationRuntime({
      store,
      ids,
      clock: fixedClock("2026-03-02T00:00:00.000Z"),
    });
    const second = await rt2.ingestFixtures();

    expect(second.signalCount).toBe(0);
    expect(second.skipped).toBe(first.signalCount);
    // Every original signal survives with identical content.
    for (const [id, excerpt] of before) {
      expect(store.getSignal(id)?.excerpt).toBe(excerpt);
    }
  });
});

describe("IdGenerator.seedFromIds", () => {
  it("resumes numbering past the highest existing id per prefix", () => {
    const ids = new IdGenerator();
    ids.seedFromIds(["sig_7", "sig_3", "link_12", "con_1", "garbage", "sig_x"]);
    expect(ids.next("sig")).toBe("sig_8");
    expect(ids.next("link")).toBe("link_13");
    expect(ids.next("con")).toBe("con_2");
    expect(ids.next("brief")).toBe("brief_1");
  });

  it("handles seeded-generator ids (prefix_seed_n)", () => {
    const ids = new IdGenerator();
    ids.seedFromIds(["link_sub_4"]);
    expect(ids.next("link")).toBe("link_5");
  });
});
