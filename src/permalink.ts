/** A message in a channel, as identified by its Slack permalink. */
export interface MessageRef {
  channel: string;
  ts: string;
}

// /archives/<channel id>/p<ts without the dot>. Only public (C…) and private
// (G…) channels: DM (D…) links are out of scope.
const PATH = /^\/archives\/([CG][A-Z0-9]+)\/p(\d{10})(\d{6})\/?$/;

/**
 * Parses a Slack message permalink, such as
 * `https://acme.slack.com/archives/C123/p1700000000123456`, into the
 * message's channel and ts. Accepts Slack's `<url|label>` wrapping and
 * surrounding whitespace, and ignores the query: a thread reply's link
 * carries `?thread_ts=…&cid=…`, but the `p…` part is still the reply's own
 * ts. Returns null for anything else.
 */
export function parsePermalink(text: string): MessageRef | null {
  let raw = text.trim();
  if (raw.startsWith("<") && raw.endsWith(">")) {
    raw = raw.slice(1, -1).split("|", 1)[0] ?? "";
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(".slack.com")) {
    return null;
  }
  const match = PATH.exec(url.pathname);
  if (!match) return null;
  const [, channel, seconds, micros] = match;
  if (!channel || !seconds || !micros) return null;
  return { channel, ts: `${seconds}.${micros}` };
}
