import { describe, expect, it } from "vitest";
import { EVAL_CASES, runEvalCase, listEvalCaseNames } from "../../evals/index.js";
import { createLogger, setLogger } from "../../observability/logger.js";

setLogger(createLogger({ level: "silent" }));

describe("evaluation harness", () => {
  // Updated for the link-quality overhaul: recurring_series_noise (sibling
  // instances of one recurring meeting must never link) and owner_ubiquity
  // (overlap on a graph-ubiquitous owner is not evidence) join the original five.
  it("has the seven required fixture cases", () => {
    expect(listEvalCaseNames().sort()).toEqual(
      [
        "conflict_detection",
        "doc_to_thread",
        "email_to_meeting",
        "false_friend_topic",
        "owner_ubiquity",
        "recurring_series_noise",
        "slack_to_calendar",
      ].sort(),
    );
  });

  for (const [name, evalCase] of Object.entries(EVAL_CASES)) {
    it(`passes eval: ${name}`, async () => {
      const result = await runEvalCase(evalCase);
      const failed = result.checks.filter((c) => !c.passed);
      // Surface failing checks in the assertion message.
      expect(failed.map((c) => `${c.name}: ${c.detail}`)).toEqual([]);
      expect(result.passed).toBe(true);
      // Every case must exercise a composable tool chain.
      expect(result.metrics.chainOccurred).toBe(true);
    });
  }
});
