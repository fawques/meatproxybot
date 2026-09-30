import { describe, expect, it } from "vitest";
import { parsePermalink } from "../src/permalink.js";

describe("parsePermalink", () => {
  it.each([
    [
      "a plain channel message link",
      "https://acme.slack.com/archives/C0123ABCD/p1700000000123456",
      { channel: "C0123ABCD", ts: "1700000000.123456" },
    ],
    [
      "a private channel (G…) link",
      "https://acme.slack.com/archives/G0123ABCD/p1700000000000100",
      { channel: "G0123ABCD", ts: "1700000000.000100" },
    ],
    [
      "a thread reply link with a thread_ts query (keeps the reply's own ts)",
      "https://acme.slack.com/archives/C0123ABCD/p1700000050654321?thread_ts=1700000000.123456&cid=C0123ABCD",
      { channel: "C0123ABCD", ts: "1700000050.654321" },
    ],
    [
      "an angle-bracketed link",
      "<https://acme.slack.com/archives/C0123ABCD/p1700000000123456>",
      { channel: "C0123ABCD", ts: "1700000000.123456" },
    ],
    [
      "an angle-bracketed, labelled link",
      "<https://acme.slack.com/archives/C0123ABCD/p1700000000123456|this message>",
      { channel: "C0123ABCD", ts: "1700000000.123456" },
    ],
    [
      "a link with surrounding whitespace",
      "  \n https://acme.slack.com/archives/C0123ABCD/p1700000000123456 \t",
      { channel: "C0123ABCD", ts: "1700000000.123456" },
    ],
    [
      "an Enterprise Grid link",
      "https://acme.enterprise.slack.com/archives/C0123ABCD/p1700000000123456",
      { channel: "C0123ABCD", ts: "1700000000.123456" },
    ],
  ])("parses %s", (_name, text, expected) => {
    expect(parsePermalink(text)).toEqual(expected);
  });

  it.each([
    ["an empty string", ""],
    ["garbage", "not a link at all"],
    [
      "a non-Slack URL",
      "https://example.com/archives/C0123ABCD/p1700000000123456",
    ],
    [
      "a look-alike host",
      "https://acme.slack.com.evil.example/archives/C0123ABCD/p1700000000123456",
    ],
    [
      "plain http",
      "http://acme.slack.com/archives/C0123ABCD/p1700000000123456",
    ],
    [
      "a DM (D…) link",
      "https://acme.slack.com/archives/D0123ABCD/p1700000000123456",
    ],
    [
      "a channel link without a message",
      "https://acme.slack.com/archives/C0123ABCD",
    ],
    [
      "a ts with too few digits",
      "https://acme.slack.com/archives/C0123ABCD/p170000000012345",
    ],
    [
      "a ts with too many digits",
      "https://acme.slack.com/archives/C0123ABCD/p17000000001234567",
    ],
    ["a user mention", "<@U0123ABCD>"],
  ])("returns null for %s", (_name, text) => {
    expect(parsePermalink(text)).toBeNull();
  });

  it("converts the ts exactly", () => {
    expect(
      parsePermalink("https://acme.slack.com/archives/C1/p1700000000123456")
        ?.ts,
    ).toBe("1700000000.123456");
  });
});
