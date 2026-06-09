import type { EvalCase, EvalResult } from "./harness.js";
import { runEvalCase } from "./harness.js";
import { slack_to_calendar } from "./cases/slack_to_calendar.js";
import { email_to_meeting } from "./cases/email_to_meeting.js";
import { doc_to_thread } from "./cases/doc_to_thread.js";
import { conflict_detection } from "./cases/conflict_detection.js";
import { false_friend_topic } from "./cases/false_friend_topic.js";
import { recurring_series_noise } from "./cases/recurring_series_noise.js";
import { owner_ubiquity } from "./cases/owner_ubiquity.js";

export * from "./harness.js";

export const EVAL_CASES: Record<string, EvalCase> = {
  slack_to_calendar,
  email_to_meeting,
  doc_to_thread,
  conflict_detection,
  false_friend_topic,
  recurring_series_noise,
  owner_ubiquity,
};

export function listEvalCaseNames(): string[] {
  return Object.keys(EVAL_CASES);
}

export function getEvalCase(name: string): EvalCase | undefined {
  return EVAL_CASES[name];
}

export async function runAllEvals(): Promise<EvalResult[]> {
  const results: EvalResult[] = [];
  for (const name of listEvalCaseNames()) {
    results.push(await runEvalCase(EVAL_CASES[name]!));
  }
  return results;
}
