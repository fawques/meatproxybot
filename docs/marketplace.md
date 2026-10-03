# Slack Marketplace: Scope Justifications

This document explains meatproxybot's Slack API scopes for marketplace submission review.

## Scope Mapping Table

| Scope              | API Methods                                      | Events           | Features                                     | Justification                                                                              |
| ------------------ | ------------------------------------------------ | ---------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `chat:write`       | `chat.postMessage`, `chat.postEphemeral`         | —                | —                                            | Posts callout messages in threads and ephemeral feedback to invokers.                      |
| `reactions:read`   | `reactions.get`                                  | `reaction_added` | —                                            | Checks if a message was already called out, and subscribes to the reaction trigger event.  |
| `reactions:write`  | `reactions.add`, `reactions.remove`              | —                | —                                            | Claims called-out messages and releases claims on posting failures.                        |
| `commands`         | —                                                | —                | `/meatproxy` slash command, message shortcut | Enables both the /meatproxy slash command and the 🥩 Call out meat proxy message shortcut. |
| `channels:history` | `conversations.history`, `conversations.replies` | —                | —                                            | Fetches called-out messages from public channel history.                                   |
| `groups:history`   | `conversations.history`, `conversations.replies` | —                | —                                            | Fetches called-out messages from private channel history.                                  |

## Detailed Justifications

### `chat:write`

Posts callout messages in message threads and sends ephemeral feedback to trigger invokers:

- **Callout messages**: When `/meatproxy`, the message shortcut, or the reaction trigger identifies a message, the bot posts a canned callout in the message's thread. This posts a mention of the message's original poster and a snarky but professional reminder to read before pasting.
- **Ephemeral feedback**: The slash command and message shortcut send the invoker an ephemeral response (visible only to them) confirming the callout, explaining why the action failed, or suggesting correct usage.

### `reactions:read`

Checks if a message was already called out and subscribes to the reaction trigger event:

- **Pre-claim check**: Before claiming a message with the bot's `:meat_proxy:` reaction, `reactions.get` checks if the message already has that reaction from the bot. This avoids posting duplicate callouts on near-simultaneous triggers.
- **Reaction trigger event**: The bot subscribes to `reaction_added` events to respond when a user reacts to a message with the trigger emoji. This event requires the `reactions:read` scope.

### `reactions:write`

Claims called-out messages and releases claims on failures:

- **Claiming**: When a message is called out, the bot adds its `:meat_proxy:` reaction to mark it. This serves as a concise marker and prevents duplicates (a user seeing the reaction may not trigger it again).
- **Rollback**: If posting the callout message fails (e.g., because the bot is not in the channel), the bot removes the reaction to allow the message to be called out again.

### `commands`

Enables the slash command and message shortcut trigger paths:

- **`/meatproxy <link>` slash command**: Users copy a message link and run the slash command to call out that message anonymously.
- **Message shortcut**: Users right-click a message, select the "🥩 Call out meat proxy" shortcut, and call it out anonymously.

### `channels:history`

Fetches called-out messages from public channel history. All three triggers (reaction, shortcut, `/meatproxy`) read the target message through a single code path: each trigger receives the channel and timestamp, but `/meatproxy <link>` has only the link (no poster or thread metadata), so the bot reads the message to extract its poster and thread. `conversations.history` fetches top-level messages and `conversations.replies` fetches thread replies. Inviting the bot to a channel is the least-privilege way to access message history, avoiding the need for `chat:write.public`.

### `groups:history`

Fetches called-out messages from private channel history. The same unified `fetchMessage` function handles both public and private channels. Group DMs (MPIMs) are not supported: they trigger `missing_scope` errors because the bot does not request `mpim:history`, so the error is caught and returned as a "dm" error.

### `connections:write`

**Note**: `connections:write` is an **app-level token scope**, not a **bot scope**. It is requested at app creation time, not at install. The Socket Mode token uses it to connect; it is not requested from users. This is an infrastructure requirement, not a user-facing permission.
