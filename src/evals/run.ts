import { runAllEvals, runEvalCase, getEvalCase, listEvalCaseNames } from "./index.js";
import { createLogger, setLogger } from "../observability/logger.js";

/**
 * Eval CLI: `tsx src/evals/run.ts [caseName]`. Runs one case or all, prints a
 * human-readable report, and exits non-zero on any failure (CI-friendly).
 */
async function main(): Promise<void> {
  setLogger(createLogger({ level: process.env.LOG_LEVEL ?? "warn", toStderr: true }));
  const arg = process.argv[2];

  const results = arg
    ? await (async () => {
        const c = getEvalCase(arg);
        if (!c) {
          console.error(`unknown eval case: ${arg}. Available: ${listEvalCaseNames().join(", ")}`);
          process.exit(2);
        }
        return [await runEvalCase(c)];
      })()
    : await runAllEvals();

  let allPassed = true;
  for (const r of results) {
    const status = r.passed ? "PASS" : "FAIL";
    console.log(`\n[${status}] ${r.caseId}  ${JSON.stringify(r.metrics)}`);
    for (const c of r.checks) {
      console.log(`   ${c.passed ? "✓" : "✗"} ${c.name} — ${c.detail}`);
    }
    allPassed &&= r.passed;
  }

  console.log(`\n${results.filter((r) => r.passed).length}/${results.length} eval cases passed.`);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
