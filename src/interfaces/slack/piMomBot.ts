import { createConstellationRuntime, type ConstellationRuntime } from "../../agent/runtime.js";
import { FileGraphStore } from "../../graph/fileStore.js";
import { createConnectors } from "../../connectors/index.js";
import { getLogger, createLogger, setLogger } from "../../observability/logger.js";
import { handleWhatIsThisConnectedTo } from "./handlers.js";

/**
 * Slack interface scaffolding built on @mariozechner/pi-mom's `SlackBot`.
 *
 * pi-mom provides the Slack Socket Mode transport (`SlackBot` + `MomHandler`);
 * we provide a handler that answers "what is this connected to?" with a Context
 * Card. The pi-mom package is an OPTIONAL dependency imported lazily, so this
 * file compiles and is unit-tested (see handlers.test.ts) without it.
 *
 * Env required to actually run: MOM_SLACK_APP_TOKEN, MOM_SLACK_BOT_TOKEN.
 */

// Minimal structural mirrors of pi-mom's types so we don't import them at build.
export interface SlackEventLike {
  type: "mention" | "dm";
  channel: string;
  ts: string;
  user: string;
  text: string;
}

export interface SlackBotLike {
  postMessage(channel: string, text: string): Promise<string>;
  postInThread?(channel: string, threadTs: string, text: string): Promise<string>;
}

export interface MomHandlerLike {
  isRunning(channelId: string): boolean;
  handleEvent(event: SlackEventLike, slack: SlackBotLike, isEvent?: boolean): Promise<void>;
  handleStop(channelId: string, slack: SlackBotLike): Promise<void>;
}

/**
 * The Constellation Slack handler. Implements pi-mom's `MomHandler` shape. Kept
 * separate from transport so it can be unit-tested with a mock SlackBot.
 */
export class ConstellationMomHandler implements MomHandlerLike {
  private running = new Set<string>();

  constructor(private readonly runtime: ConstellationRuntime) {}

  isRunning(channelId: string): boolean {
    return this.running.has(channelId);
  }

  async handleEvent(event: SlackEventLike, slack: SlackBotLike): Promise<void> {
    this.running.add(event.channel);
    try {
      const reply = await handleWhatIsThisConnectedTo(event.text, this.runtime);
      await slack.postMessage(event.channel, reply.text);
    } catch (err) {
      getLogger().error({ event: "slack_handler_error", err: String(err) }, "slack handler failed");
      await slack.postMessage(event.channel, `Sorry, I hit an error: ${String(err)}`);
    } finally {
      this.running.delete(event.channel);
    }
  }

  async handleStop(channelId: string): Promise<void> {
    this.running.delete(channelId);
  }
}

export interface StartSlackBotOptions {
  appToken?: string;
  botToken?: string;
  workingDir?: string;
  runtime?: ConstellationRuntime;
}

/**
 * Boot the Slack bot. Lazily loads pi-mom; throws a clear error if the package
 * or tokens are missing. This is the only function that touches Slack at runtime.
 */
export async function startSlackBot(opts: StartSlackBotOptions = {}): Promise<void> {
  setLogger(createLogger({ toStderr: true, level: process.env.LOG_LEVEL ?? "info" }));
  const logger = getLogger();

  const appToken = opts.appToken ?? process.env.MOM_SLACK_APP_TOKEN;
  const botToken = opts.botToken ?? process.env.MOM_SLACK_BOT_TOKEN;
  if (!appToken || !botToken) {
    throw new Error(
      "Slack tokens missing. Set MOM_SLACK_APP_TOKEN and MOM_SLACK_BOT_TOKEN (see pi-mom Slack setup).",
    );
  }

  const runtime =
    opts.runtime ??
    createConstellationRuntime({
      store: new FileGraphStore(process.env.CONSTELLATION_GRAPH ?? "./.constellation/graph.json"),
      connectors: createConnectors(),
    });

  // Lazy, optional import of pi-mom's Slack transport.
  // The package's package.json `main` is currently broken, so we import the
  // slack subpath directly. TODO: switch to the package root once it exports one.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mom: any = await import("@mariozechner/pi-mom/dist/slack.js").catch(() => null);
  if (!mom?.SlackBot) {
    throw new Error(
      "@mariozechner/pi-mom not available. Install it to run the Slack interface.",
    );
  }

  const handler = new ConstellationMomHandler(runtime);
  // TODO: pi-mom's SlackBot also needs a ChannelStore; wire a real one here.
  // For the scaffold we pass a minimal in-memory store shim.
  const store = createMinimalChannelStore();
  const bot = new mom.SlackBot(handler, {
    appToken,
    botToken,
    workingDir: opts.workingDir ?? "./.constellation/slack",
    store,
  });

  await bot.start();
  logger.info({ event: "slack_started" }, "Constellation Slack bot started");
}

/** Minimal ChannelStore shim (TODO: replace with pi-mom's real store). */
function createMinimalChannelStore(): Record<string, unknown> {
  return {
    logMessage: () => {},
    getMessages: () => [],
    downloadAttachments: async () => [],
  };
}

// Run directly: `tsx src/interfaces/slack/piMomBot.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  startSlackBot().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
