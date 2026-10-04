import type { Logger } from "@slack/bolt";

/** The public landing page, hosted on GitHub Pages from `site/`. */
export const LANDING_PAGE_URL = "https://fawques.github.io/meatproxybot/";

/**
 * The deep link that opens the app in the Slack client, on the workspace it
 * was just installed in. Without an app id it opens the workspace instead.
 */
export function slackAppUrl(teamId: string, appId: string | undefined): string {
  const team = encodeURIComponent(teamId);
  return appId
    ? `slack://app?team=${team}&id=${encodeURIComponent(appId)}`
    : `slack://open?team=${team}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The page shown after a successful install. It sends the browser straight
 * back into Slack; the links are the fallback when the Slack client does not
 * open (no desktop app, or the browser blocked the `slack://` link).
 */
export function installSuccessPage(slackUrl: string): string {
  const slack = escapeHtml(slackUrl);
  const landing = escapeHtml(LANDING_PAGE_URL);
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="refresh" content="0; url=${slack}">` +
    "<title>meatproxybot installed</title></head><body>" +
    "<h1>meatproxybot is installed 🥩</h1>" +
    "<p>Opening Slack… Check your DMs from meatproxybot to get started.</p>" +
    `<p><a href="${slack}">Open Slack</a> if it didn't open on its own, ` +
    `or go back to <a href="${landing}">meatproxybot's home page</a>.</p>` +
    "</body></html>"
  );
}

/** The welcome DM sent to whoever installed the app. */
export function welcomeText(triggerEmoji: string): string {
  return [
    "👋 Thanks for installing meatproxybot! It nudges teammates to read AI-generated text before they paste it.",
    "",
    "*1. Invite me to your channels.* I only work in channels I'm in: run `/invite @meatproxybot` in each one.",
    "",
    "*2. Call out a message* in one of three ways. I post a reminder in its thread and add 🥩:",
    "• *Message shortcut* (anonymous): open the message's _More actions_ (⋮) menu and choose _🥩 Call out meat proxy_.",
    "• *`/meatproxy <message link>`* (anonymous): copy the message's link and paste it after the command.",
    `• *React with :${triggerEmoji}:* (not anonymous: Slack shows who reacted).`,
    "",
    `*3. Set up the trigger emoji.* The reaction trigger only works once :${triggerEmoji}: exists in this workspace. ` +
      `Upload a custom emoji named \`${triggerEmoji}\`, or pick another one with \`/meatproxy emoji <name>\`.`,
  ].join("\n");
}

/** The slice of the Slack client that sending the welcome DM needs. */
export interface WelcomeClient {
  chat: {
    postMessage(args: {
      token: string;
      channel: string;
      text: string;
    }): Promise<unknown>;
  };
}

/**
 * DMs the welcome message to the installer, in the app's Messages tab.
 * A failure is logged and swallowed: the install has already succeeded.
 */
export async function sendWelcomeDm(
  client: WelcomeClient,
  args: { botToken: string; userId: string; triggerEmoji: string },
  logger: Logger,
): Promise<void> {
  try {
    await client.chat.postMessage({
      token: args.botToken,
      channel: args.userId,
      text: welcomeText(args.triggerEmoji),
    });
  } catch (err) {
    logger.warn(
      `Could not send the welcome DM to ${args.userId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
