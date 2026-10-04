import type { webApi } from "@slack/bolt";
import { pickCallout, renderCallout } from "./callouts.js";
import type { UsageEvent } from "./usage.js";

/** The reaction the bot leaves on a message it called out. */
export const RESPONSE_EMOJI = "cut_of_meat";

type WebClient = webApi.WebClient;

/** The slice of Slack's WebClient that callOut uses. */
export interface CallOutClient {
  conversations: Pick<WebClient["conversations"], "history" | "replies">;
  reactions: Pick<WebClient["reactions"], "get" | "add" | "remove">;
  chat: Pick<WebClient["chat"], "postMessage">;
}

export type CallOutTrigger = "reaction" | "shortcut" | "command";

export type CallOutErrorReason =
  "dm" | "own_message" | "not_in_channel" | "not_found" | "unknown";

export type CallOutResult =
  | { status: "posted" }
  | { status: "already" }
  | { status: "error"; reason: CallOutErrorReason };

export interface CallOutOptions {
  client: CallOutClient;
  botUserId: string;
  target: {
    channel: string;
    ts: string;
    /**
     * The parent `thread_ts` when the trigger already knows the target is a
     * thread reply. Optional: without it, callOut finds replies on its own.
     */
    threadTs?: string | undefined;
  };
  /** The user who triggered the callout. Logged, never posted. */
  invoker: string;
  trigger: CallOutTrigger;
  /** The workspace the callout happens in, for usage tracking. */
  teamId?: string | undefined;
  /**
   * Stores the callout for the weekly usage stats. Unset when there is no
   * database (single-workspace mode). A failure is logged, never thrown.
   */
  recordUsage?: ((event: UsageEvent) => Promise<void>) | undefined;
  /** Writes the audit log line. Defaults to stdout. */
  log?: (line: string) => void;
  /** Random source for the callout pick, injectable for tests. */
  rng?: () => number;
}

interface TargetMessage {
  ts: string;
  user?: string | undefined;
  thread_ts?: string | undefined;
}

/**
 * Calls out a message: claims it with the bot's :cut_of_meat: reaction, then
 * posts a canned callout mentioning its poster in the message's thread.
 * Shared by every trigger. The callout never reveals who triggered it, but
 * every call writes one audit JSON line naming the invoker.
 */
export async function callOut(options: CallOutOptions): Promise<CallOutResult> {
  const { target, invoker, trigger } = options;
  const log =
    options.log ??
    ((line: string) => {
      console.log(line);
    });
  // Filled in by run as soon as the poster is known, so the audit line
  // names them even when a later Slack call throws.
  const audit: { poster?: string } = {};
  let result: CallOutResult;
  try {
    result = await run(options, audit);
  } catch (err) {
    result = { status: "error", reason: errorReason(err) };
  }
  log(
    JSON.stringify({
      event: "callout",
      trigger,
      invoker,
      channel: target.channel,
      ts: target.ts,
      poster: audit.poster ?? null,
      status: result.status,
      ...(result.status === "error" ? { reason: result.reason } : {}),
    }),
  );
  if (options.recordUsage && options.teamId) {
    try {
      await options.recordUsage({
        teamId: options.teamId,
        trigger,
        status: result.status,
        invoker,
      });
    } catch (err) {
      log(
        JSON.stringify({
          event: "usage_record_failed",
          trigger,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return result;
}

async function run(
  { client, botUserId, target, rng }: CallOutOptions,
  audit: { poster?: string },
): Promise<CallOutResult> {
  // 1. DMs are out of scope. Group DMs are caught below: their history needs
  // a scope the bot does not have, so fetching one fails with missing_scope.
  if (target.channel.startsWith("D")) {
    return { status: "error", reason: "dm" };
  }

  // 2. Find the message, its poster and its thread.
  let message: TargetMessage | undefined;
  try {
    message = await fetchMessage(client, target);
  } catch (err) {
    // The bot has history scopes for public and private channels only.
    if (slackErrorCode(err) === "missing_scope") {
      return { status: "error", reason: "dm" };
    }
    throw err;
  }
  if (!message) {
    return { status: "error", reason: "not_found" };
  }
  const poster = message.user;
  if (!poster) {
    // Nobody to mention (e.g. a webhook message with no user).
    return { status: "error", reason: "unknown" };
  }
  audit.poster = poster;

  // 3. The bot does not call itself out.
  if (poster === botUserId) {
    return { status: "error", reason: "own_message" };
  }

  // 4. The bot's own reaction marks a message already called out.
  const reactions = await client.reactions.get({
    channel: target.channel,
    timestamp: target.ts,
    full: true,
  });
  const alreadyReacted = reactions.message?.reactions?.some(
    (r) =>
      (r.name === RESPONSE_EMOJI || r.name === "meat_proxy") &&
      r.users?.includes(botUserId),
  );
  if (alreadyReacted) {
    return { status: "already" };
  }

  // 5. Claim the message before posting, so near-simultaneous triggers
  // lose the race here (already_reacted) instead of posting twice.
  try {
    await client.reactions.add({
      channel: target.channel,
      timestamp: target.ts,
      name: RESPONSE_EMOJI,
    });
  } catch (err) {
    if (slackErrorCode(err) === "already_reacted") {
      return { status: "already" };
    }
    throw err;
  }

  // 6. Post the callout in the message's thread.
  try {
    await client.chat.postMessage({
      channel: target.channel,
      thread_ts: message.thread_ts ?? message.ts,
      text: renderCallout(pickCallout(target.channel, rng), poster),
    });
  } catch (err) {
    // Release the claim so the message can be called out again.
    await client.reactions
      .remove({
        channel: target.channel,
        timestamp: target.ts,
        name: RESPONSE_EMOJI,
      })
      .catch(() => undefined);
    throw err;
  }
  return { status: "posted" };
}

/**
 * Fetches the target message. A top-level message comes from the channel
 * history; a thread reply is not there, so it is looked up in its thread.
 */
async function fetchMessage(
  client: CallOutClient,
  target: CallOutOptions["target"],
): Promise<TargetMessage | undefined> {
  if (target.threadTs === undefined || target.threadTs === target.ts) {
    const history = await client.conversations.history({
      channel: target.channel,
      latest: target.ts,
      inclusive: true,
      limit: 1,
    });
    const found = history.messages?.find((m) => m.ts === target.ts);
    if (found) return toTargetMessage(found, target.ts);
  }
  // Not in the channel history: a thread reply. conversations.replies
  // accepts the ts of any message in a thread.
  try {
    const replies = await client.conversations.replies({
      channel: target.channel,
      ts: target.threadTs ?? target.ts,
      latest: target.ts,
      oldest: target.ts,
      inclusive: true,
    });
    const found = replies.messages?.find((m) => m.ts === target.ts);
    return found ? toTargetMessage(found, target.ts) : undefined;
  } catch (err) {
    if (slackErrorCode(err) === "thread_not_found") return undefined;
    throw err;
  }
}

function toTargetMessage(
  message: { user?: string; thread_ts?: string },
  ts: string,
): TargetMessage {
  return { ts, user: message.user, thread_ts: message.thread_ts };
}

/** The Slack API error code (`data.error`) of a WebClient error, if any. */
function slackErrorCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("data" in err)) {
    return undefined;
  }
  const data = err.data;
  if (typeof data !== "object" || data === null || !("error" in data)) {
    return undefined;
  }
  return typeof data.error === "string" ? data.error : undefined;
}

function errorReason(err: unknown): CallOutErrorReason {
  switch (slackErrorCode(err)) {
    case "not_in_channel":
      return "not_in_channel";
    case "channel_not_found":
    case "message_not_found":
    case "thread_not_found":
      return "not_found";
    default:
      return "unknown";
  }
}
