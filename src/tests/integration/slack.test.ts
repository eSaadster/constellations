import { describe, expect, it } from "vitest";
import { createConstellationRuntime } from "../../agent/runtime.js";
import { MockConnectorRegistry } from "../../connectors/mock.js";
import { DEMO_FIXTURES } from "../../connectors/fixtures.js";
import {
  parseSlackLink,
  handleWhatIsThisConnectedTo,
  isConnectionQuestion,
} from "../../interfaces/slack/handlers.js";
import { ConstellationMomHandler, type SlackBotLike } from "../../interfaces/slack/piMomBot.js";
import { createLogger, setLogger } from "../../observability/logger.js";
import { IdGenerator, fixedClock } from "../../util/ids.js";

setLogger(createLogger({ level: "silent" }));

function runtime() {
  return createConstellationRuntime({
    connectors: new MockConnectorRegistry(DEMO_FIXTURES),
    ids: new IdGenerator("slack"),
    clock: fixedClock("2026-01-01T00:00:00.000Z"),
  });
}

describe("Slack handler logic", () => {
  it("parses a Slack message permalink", () => {
    const link = parseSlackLink(
      "what is <https://acme.slack.com/archives/C_APOLLO/p1700000100> connected to?",
    );
    expect(link?.channel).toBe("C_APOLLO");
    expect(link?.externalId).toBe("C_APOLLO/p1700000100");
  });

  it("detects the connection question", () => {
    expect(isConnectionQuestion("what is this connected to?")).toBe(true);
    expect(isConnectionQuestion("good morning")).toBe(false);
  });

  it("answers 'what is this connected to?' with a Context Card (auto-ingesting)", async () => {
    const reply = await handleWhatIsThisConnectedTo(
      "hey @constellation what is https://acme.slack.com/archives/C_APOLLO/p1700000100 connected to?",
      runtime(),
    );
    expect(reply.matched).toBe(true);
    expect(reply.text).toContain("Connections");
    expect(reply.text).toMatch(/evidence-backed claim/);
  });
});

describe("ConstellationMomHandler (pi-mom adapter)", () => {
  it("posts a Context Card reply via a mock SlackBot", async () => {
    const posted: Array<{ channel: string; text: string }> = [];
    const slack: SlackBotLike = {
      async postMessage(channel, text) {
        posted.push({ channel, text });
        return "ts1";
      },
    };
    const handler = new ConstellationMomHandler(runtime());
    await handler.handleEvent(
      {
        type: "mention",
        channel: "C_APOLLO",
        ts: "1",
        user: "U_alice",
        text: "what is https://acme.slack.com/archives/C_APOLLO/p1700000100 connected to?",
      },
      slack,
    );
    expect(posted).toHaveLength(1);
    expect(posted[0]!.text).toContain("Connections");
    expect(handler.isRunning("C_APOLLO")).toBe(false);
  });
});
