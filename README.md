# meatproxybot

don't be a meat proxy

A Slack bot that calls out people who paste AI-generated text without
reading it. Trigger it on a message (a reaction, a message shortcut or a
slash command) and it posts a canned callout in the message's thread and
adds `:meat_proxy:`. It runs in Socket Mode, so it needs no public URL.

## Setup

You need Node 22.9 or later and a Slack workspace where you can create apps.

1. **Create the Slack app from `manifest.yml`.** At
   <https://api.slack.com/apps>, choose _Create New App_ → _From a
   manifest_, pick the workspace and paste in `manifest.yml`. It declares
   Socket Mode, the bot scopes, the `reaction_added` event, the
   `/meatproxy` command and the _🥩 Call out meat proxy_ shortcut.
2. **Generate the app-level token and install the app.** Under _Basic
   Information_ → _App-Level Tokens_, generate a token with the
   `connections:write` scope (`xapp-…`). Then, under _Install App_, install
   it to the workspace and copy the _Bot User OAuth Token_ (`xoxb-…`).
3. **Upload a custom emoji named `:meat_proxy:`.** The repo ships no
   artwork: pick any image. To use another emoji, set `TRIGGER_EMOJI`.
4. **Invite the bot to channels** where it should work, with
   `/invite @meatproxybot`.
5. **Fill in `.env`:** `cp .env.example .env`, then set `SLACK_BOT_TOKEN`
   and `SLACK_APP_TOKEN`. `.env` is gitignored; never commit it.
6. **Run it with `npm run dev`** after `npm ci`. It logs a JSON `ready` line
   once connected. For production, `npm run build && npm start`.

### Development

```sh
npm ci
npm run lint && npm run typecheck && npm test
```

Tests never connect to Slack and need no Slack tokens.

### Run with Docker

The bot only makes outbound connections, so the container exposes no port.
With `.env` filled in (step 5 above):

```sh
docker build -t meatproxybot .
docker run --rm --env-file .env meatproxybot
```

The image runs the compiled bot as the unprivileged `node` user. `.env` is
excluded from the build context, so tokens never end up in the image; pass
them at run time. Without them the container exits with status 1 and logs
which variables are missing.

## Usage

### Message shortcut (anonymous)

Hover over a message, open its _More actions_ (⋮) menu and choose
_🥩 Call out meat proxy_. (The first time, it may be under _More message
shortcuts…_.) The bot posts a callout in the message's thread and adds
`:meat_proxy:`. Nobody sees who triggered it: only you get a reply, an
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

The only record of who triggered a callout is the bot's stdout audit log.
If the bot isn't in the channel it may not be able to reply at all; the
failure is logged.

## Agents

Issues in the Linear project
[meatproxybot](https://linear.app/vguzman-test/project/meatproxybot-5f529c766fa9)
are worked by [Symphony](https://github.com/mscalessio/symphony-claude)
agents inside a Docker Sandboxes microVM. `WORKFLOW.md` tells them how to
work; `sandbox/README.md` covers setting the sandbox up.

Create it once from `main` with `sbx env run`, run `/login`, then exit.
From then on, `sbx env run -d` starts it detached, and Symphony starts on
its own. The dashboard is at <http://127.0.0.1:4547>.
