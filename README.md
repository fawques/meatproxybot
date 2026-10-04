# meatproxybot

Nudge teammates to read AI-generated text before they paste it.

A Slack bot that helps catch AI-generated content before it's shared. Trigger it
by reacting with 🥩, using a message shortcut, or the /meatproxy command to post
a light-hearted reminder in the thread. Trigger it on a message (a reaction, a message shortcut or a
slash command) and it posts a canned callout in the message's thread and
adds 🥩 (`:cut_of_meat:`). It listens on HTTP and requires a public URL.

## Public Pages

- **Landing page:** `https://fawques.github.io/meatproxybot/` — overview and install link
- **Privacy policy:** `https://fawques.github.io/meatproxybot/privacy/` — data practices and rights
- **Support page:** `https://fawques.github.io/meatproxybot/support/` — contact and FAQ

These pages are hosted on GitHub Pages and are required for marketplace submission.

## Setup

You need Node 22.9 or later and a Slack workspace where you can create apps.

1. **Set up a public URL** pointing to this bot's HTTP receiver on port 3000.
   For local development, use `cloudflared tunnel --url http://localhost:3000`
   (or any HTTPS tunnel).
2. **Update `manifest.yml`:** Replace the placeholder base URL
   `https://meatproxybot.example.com` with the public base URL from step 1.
   In production that is `https://api.<domain>/meatproxybot`, so the request
   URL becomes `https://api.<domain>/meatproxybot/slack/events`.
3. **Create the Slack app from `manifest.yml`.** At
   <https://api.slack.com/apps>, choose _Create New App_ → _From a
   manifest_, pick the workspace and paste in the updated `manifest.yml`. It
   declares the bot scopes, the `reaction_added` event, the `/meatproxy`
   command and the _🥩 Call out meat proxy_ shortcut, plus the HTTP request
   URLs. If using OAuth (multi-workspace), note that the manifest's
   `redirect_urls` must include `<public-base-url>/slack/oauth_redirect`.
4. **Copy the signing secret and install the app.** Under _Basic
   Information_ → _App Credentials_, copy the _Signing Secret_. Then, under
   _Install App_, install it to the workspace and copy the _Bot User OAuth
   Token_ (`xoxb-…`).
5. **Upload a custom trigger emoji named `:meat_proxy:`** if you want the
   reaction trigger. The repo ships no artwork: pick any image. To use another
   emoji instead, set `TRIGGER_EMOJI` or a workspace-specific trigger (see
   [Reaction trigger](#reaction-trigger-not-anonymous)); a built-in emoji needs
   no upload. The bot's response reaction, 🥩 (`:cut_of_meat:`), is a built-in
   Slack emoji, so it needs no upload either. The message shortcut and
   `/meatproxy` work without any custom emoji.
6. **Invite the bot to channels** where it should work, with
   `/invite @meatproxybot`.
7. **Fill in `.env`:** `cp .env.example .env`, then set `SLACK_SIGNING_SECRET`.
   For OAuth mode (multi-workspace), also set `SLACK_CLIENT_ID`,
   `SLACK_CLIENT_SECRET`, `SLACK_STATE_SECRET`, `PUBLIC_BASE_URL`,
   `DATABASE_URL`, and `INSTALLATION_ENCRYPTION_KEY`
   (`openssl rand -base64 32`). For legacy mode (single workspace), set
   `SLACK_BOT_TOKEN` instead; OAuth mode ignores it and uses each
   workspace's stored token.
   `.env` is gitignored; never commit it.
8. **Run it with `npm run dev`** after `npm ci`. It logs a JSON `ready` line
   once listening. For production, `npm run build && npm start`.

### Development

```sh
npm ci
npm run lint && npm run typecheck && npm test
```

Tests never connect to Slack and need no Slack tokens.

### Run with Docker

The bot listens on port 3000 (or the `PORT` env var). With `.env` filled in
and a public URL forwarding to the container on port 3000:

```sh
docker build -t meatproxybot .
docker run --rm -p 3000:3000 --env-file .env meatproxybot
```

The image runs the compiled bot as the unprivileged `node` user. `.env` is
excluded from the build context, so tokens never end up in the image; pass
them at run time. Without them the container exits with status 1 and logs
which variables are missing. The container includes a health check that
queries the `/healthz` endpoint.

## Usage

### Reaction trigger (not anonymous)

React to a message with `:meat_proxy:` (or set `TRIGGER_EMOJI` to any other
emoji) and the bot calls it out: it adds 🥩 (`:cut_of_meat:`) and posts a
callout in the message's thread.

This trigger is **not anonymous**: Slack shows everyone who reacted. For an
anonymous callout, use the message shortcut or `/meatproxy` instead.

The reactor gets no feedback. A message that was already called out is
left alone, and errors (for example, the bot is not in the channel) are
only logged at warn level. Removing the reaction does nothing.

On a workspace without a custom `:meat_proxy:` emoji, this trigger is
dormant. To activate it, upload a `:meat_proxy:` emoji or configure a
workspace-specific trigger emoji.

#### Per-Workspace Configuration

Each workspace can configure its own trigger emoji independently. The bot uses:

1. Workspace-specific configuration (if configured), or
2. The `TRIGGER_EMOJI` environment variable (defaults to `:meat_proxy:`)

To configure a workspace-specific trigger emoji, the bot stores the setting in
its workspace installation state. Future versions may include a configuration
command. For now, workspace-specific emoji can be set by modifying the
`WorkspaceStore` in your deployment.

Example:

```typescript
import { InMemoryWorkspaceStore } from "./src/workspaceStore.js";

const store = new InMemoryWorkspaceStore();
store.setTriggerEmoji("T123456", "robot_face");
store.setTriggerEmoji("T789012", "tada");

const config = loadConfig();
config.workspaceStore = store;
const app = createApp(config);
```

This allows `T123456` workspace to trigger with `:robot_face:` and `T789012`
workspace to trigger with `:tada:`, while other workspaces fall back to the
global `TRIGGER_EMOJI` setting.

### Message shortcut (anonymous)

Hover over a message, open its _More actions_ (⋮) menu and choose
_🥩 Call out meat proxy_. (The first time, it may be under _More message
shortcuts…_.) The bot posts a callout in the message's thread and adds 🥩
(`:cut_of_meat:`). Nobody sees who triggered it: only you get a reply, an
ephemeral one, and you get one on success too, so a failure is never
mistaken for success:

| Reply                                         | Meaning                                   |
| --------------------------------------------- | ----------------------------------------- |
| 🥩 Called out. Nobody knows it was you.       | The callout was posted.                   |
| Already called out, it's on the record.       | The message was called out before.        |
| I only work in channels, not DMs.             | The message is in a DM or group DM.       |
| Nice try, I'm not calling myself out.         | The message is the bot's own.             |
| Invite me to this channel first (`/invite …`) | The bot is not in the channel.            |
| Couldn't call that out, sorry.                | Anything else; the reason is in the logs. |

The only record of who triggered a callout is the bot's stdout audit log
(the usage statistics keep only a keyed hash of the invoker).
If the bot isn't in the channel it may not be able to reply at all; the
failure is logged.

### `/meatproxy <message link>`

Calls out a message anonymously from the keyboard. Open the message's
_More actions_ (⋮) menu, or right-click it, choose _Copy link_, then run
`/meatproxy <link>` in any channel. The bot calls out the linked message in
its thread, adds 🥩 (`:cut_of_meat:`), and replies to you alone, ephemerally,
with the same replies as the shortcut. Nobody else sees that you ran it; you
only appear in the bot's audit log.

- The link is required: `/meatproxy` alone, or `/meatproxy help`, shows
  usage instead of guessing a message.
- Links to public and private channel messages and thread replies work. DM
  links do not, and the bot must be in the message's channel.

## Usage statistics

In OAuth mode, every callout is also stored in the `usage_events` table:
workspace, trigger, status, time, and a keyed hash of the invoker (never
the raw user ID). Rows are pruned after 30 days and deleted with the
installation on uninstall. To see how close the app is to the Slack
Marketplace minimum (10 active workspaces, 10 weekly active users):

```sh
npm run build   # not needed in the production image
npm run stats   # reads DATABASE_URL and DATABASE_SCHEMA
```

It prints the active workspaces, distinct invokers and callouts of the
last 7 days.

## Agents

Issues in the Linear project
[meatproxybot](https://linear.app/vguzman-test/project/meatproxybot-5f529c766fa9)
are worked by [Symphony](https://github.com/mscalessio/symphony-claude)
agents inside a Docker Sandboxes microVM. `WORKFLOW.md` tells them how to
work; `sandbox/README.md` covers setting the sandbox up.

Create it once from `main` with `sbx env run`, run `/login`, then exit.
From then on, `sbx env run -d` starts it detached, and Symphony starts on
its own. The dashboard is at <http://127.0.0.1:4547>.
