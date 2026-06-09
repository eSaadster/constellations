#!/usr/bin/env node
import { resolve } from "node:path";
import { createConstellationRuntime } from "../../agent/runtime.js";
import { FileGraphStore } from "../../graph/fileStore.js";
import { createConnectors } from "../../connectors/index.js";
import { runEvalCase, runAllEvals, getEvalCase, listEvalCaseNames } from "../../evals/index.js";
import { runModelDriven } from "../../agent/piModelDriver.js";
import { createLogger, setLogger } from "../../observability/logger.js";

/**
 * Constellation CLI.
 *
 * Commands:
 *   constellation health
 *   constellation ingest-fixtures
 *   constellation connect <signalId>
 *   constellation context-card <signalId>
 *   constellation eval [caseName]
 *   constellation signals            (list ingested signals + ids)
 *   constellation model "<task>"     (model-driven path; needs a gateway + key)
 *
 * Graph state persists to ./.constellation/graph.json so ingest + connect work
 * across separate invocations. The deterministic commands need NO API key; only
 * `model` requires a gateway base URL + key (loaded from .env).
 */

const GRAPH_PATH = resolve(process.env.CONSTELLATION_GRAPH ?? "./.constellation/graph.json");

function buildRuntime(): { runtime: ReturnType<typeof createConstellationRuntime>; store: FileGraphStore } {
  const store = new FileGraphStore(GRAPH_PATH);
  const runtime = createConstellationRuntime({ store, connectors: createConnectors() });
  return { runtime, store };
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

const HELP = `Constellation CLI

Usage:
  constellation health
  constellation ingest-fixtures
  constellation signals
  constellation connect <signalId>
  constellation context-card <signalId>
  constellation eval [caseName]
  constellation model "<task>"

The model command uses the LLM-backed path. Configure a gateway in .env:
  ANTHROPIC_BASE_URL   custom Anthropic-compatible gateway URL
  ANTHROPIC_API_KEY    your gateway key
  CONSTELLATION_MODEL  wire model id (default: glm-5.1)

A connection is not a vibe. It is an evidence-backed claim.`;

async function main(): Promise<void> {
  // Load .env so the model-driven path sees the gateway base URL + key. Uses the
  // Node>=20.12 built-in (no dependency); guarded for older runtimes and for an
  // absent .env (loadEnvFile throws if the file is missing).
  try {
    if (typeof process.loadEnvFile === "function") process.loadEnvFile();
  } catch {
    // No .env present — fine; consumers read process.env directly.
  }
  setLogger(createLogger({ level: process.env.LOG_LEVEL ?? "warn", toStderr: true }));
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return;

    case "health": {
      const { runtime } = buildRuntime();
      print(runtime.health());
      return;
    }

    case "ingest-fixtures": {
      const { runtime, store } = buildRuntime();
      const result = await runtime.ingestFixtures();
      store.save();
      print({
        ingested: result.signalCount,
        toolCalls: result.snapshot.calls.length,
        chainOccurred: result.snapshot.chainOccurred,
        signals: runtime.store
          .listSignals()
          .map((s) => ({ id: s.id, source: s.source, title: s.title })),
      });
      return;
    }

    case "signals": {
      const { runtime } = buildRuntime();
      print(
        runtime.store
          .listSignals()
          .map((s) => ({ id: s.id, source: s.source, title: s.title, timestamp: s.timestamp })),
      );
      return;
    }

    case "connect": {
      const signalId = args[0];
      if (!signalId) return fail("connect requires <signalId>");
      const { runtime, store } = buildRuntime();
      const result = await runtime.connect(signalId);
      store.save();
      print({
        anchorSignalId: result.anchorSignalId,
        commit: result.commit,
        links: result.linkResult.proposedLinks.map((l) => ({
          relation: l.relation,
          status: l.status,
          confidence: l.confidence,
          target: l.targetSignalId === signalId ? l.sourceSignalId : l.targetSignalId,
          rationale: l.evidence.rationale,
        })),
        excluded: result.linkResult.exclusions,
        inconclusive: result.linkResult.inconclusive,
      });
      return;
    }

    case "context-card": {
      const signalId = args[0];
      if (!signalId) return fail("context-card requires <signalId>");
      const { runtime, store } = buildRuntime();
      const result = await runtime.generateContextCard(signalId);
      store.save();
      print(result.contextCard);
      return;
    }

    case "eval": {
      const name = args[0];
      const results = name
        ? await (async () => {
            const c = getEvalCase(name);
            if (!c) return fail(`unknown eval case: ${name}. Available: ${listEvalCaseNames().join(", ")}`);
            return [await runEvalCase(c)];
          })()
        : await runAllEvals();
      if (!results) return;
      for (const r of results) {
        console.log(`[${r.passed ? "PASS" : "FAIL"}] ${r.caseId} ${JSON.stringify(r.metrics)}`);
        for (const c of r.checks) console.log(`   ${c.passed ? "✓" : "✗"} ${c.name} — ${c.detail}`);
      }
      const passed = results.filter((r) => r.passed).length;
      console.log(`\n${passed}/${results.length} eval cases passed.`);
      process.exit(passed === results.length ? 0 : 1);
      return;
    }

    case "model": {
      const task = args.join(" ").trim();
      if (!task) return fail('model requires <task>, e.g. constellation model "connect my recent signals"');
      const { runtime, store } = buildRuntime();
      try {
        // Model id defaults to glm-5.1 inside runModelDriven (env CONSTELLATION_MODEL
        // overrides). Base URL + key come from .env (ANTHROPIC_BASE_URL/KEY).
        const text = await runModelDriven({ task, runtime });
        store.save();
        // Model output is prose, not a JSON artifact — print it raw.
        console.log(text.trim());
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    default:
      return fail(`unknown command: ${command}\n\n${HELP}`);
  }
}

function fail(message: string): undefined {
  console.error(message);
  process.exitCode = 2;
  return undefined;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
