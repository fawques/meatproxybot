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
   (or any HTTPS tunnel). For production, see deployment docs.
2. **Update `manifest.yml`:** Replace the placeholder base URL
   `https://meatproxybot.example.com` with the public base URL from step 1.
   In production that is `https://api.<domain>/meatproxybot`, so the request
   URL becomes `https://api.<domain>/meatproxybot/slack/events`.
3. **Create the Slack app from `manifest.yml`.** At
   <https://api.slack.com/apps>, choose _Create New App_ → _From a
   manifest_, pick the workspace and paste in the updated `manifest.yml`. It
   declares the bot scopes, the `reaction_added` event, the `/meatproxy`
   command and the _🥩 Call out meat proxy_ shortcut, plus the HTTP request
   URLs.
4. **Copy the signing secret and install the app.** Under _Basic
   Information_ → _App Credentials_, copy the _Signing Secret_. Then, under
   _Install App_, install it to the workspace and copy the _Bot User OAuth
   Token_ (`xoxb-…`).
5. **Upload a custom emoji named `:cut_of_meat:`.** The repo ships no
   artwork: pick any image. To use a different response emoji, edit `src/callOut.ts`.
6. **Invite the bot to channels** where it should work, with
   `/invite @meatproxybot`.
7. **Fill in `.env`:** `cp .env.example .env`, then set `SLACK_BOT_TOKEN`
   and `SLACK_SIGNING_SECRET`. `.env` is gitignored; never commit it.
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

## Deployment

The bot is deployed to a shared free virtual machine (`e2-micro`, $0) managed
by the [personal-site](https://github.com/fawques/personal-site) project. The
deployment is automatic on every merge to `main` (limited to paths that affect
the image). The deployed instance is always available at
`https://api.<domain>/meatproxybot/`.

### Prerequisites (human-only setup before deployment)

1. **Merge the personal-site PR** that adds the reusable deployment workflow:
   <https://github.com/fawques/personal-site/pull/23>. Then run the
   `deploy-infra.yml` workflow once to provision the deployment infrastructure
   and secrets on the VM.

2. **Create Secret Manager secrets** in the GCP project. Each secret must be
   named `meatproxybot--<NAME>` (example: `meatproxybot--SLACK_SIGNING_SECRET`):
   - `meatproxybot--PUBLIC_BASE_URL` (the base URL from the URL replacement
     step below)
   - `meatproxybot--SLACK_SIGNING_SECRET`
   - `meatproxybot--SLACK_CLIENT_ID`
   - `meatproxybot--SLACK_CLIENT_SECRET`
   - `meatproxybot--SLACK_STATE_SECRET`
   - `meatproxybot--INSTALLATION_ENCRYPTION_KEY`

3. **Set GitHub repository secrets and variables:**
   - Repository secrets: `GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `DEPLOY_SSH_HOST`,
     `DEPLOY_SSH_KEY` (these are shared across all projects on the VM).
   - Repository variables: `GCP_PROJECT_ID`, `PUBLIC_BASE_URL` (the base URL
     from the URL replacement step below).

4. **Update `manifest.yml`:** Replace the placeholder request URL with the
   deployed URL. The health check and event reception paths are:
   - Request URL: `https://api.<domain>/meatproxybot/slack/events`
   - OAuth redirect URL: `https://api.<domain>/meatproxybot/slack/oauth_redirect`
   - (Substitute the actual `<domain>` value.)

5. **Set up external uptime monitoring** on `https://api.<domain>/meatproxybot/healthz`
   (HTTP GET, expects 200). This is optional but recommended for the
   2-business-day support promise.

### How Deployment Works

The `.github/workflows/deploy.yml` workflow:

1. Builds the Docker image and pushes it to Google Cloud Artifact Registry,
   tagged with the commit SHA.
2. Calls the reusable deployment workflow from personal-site, which:
   - Logs in to the VM via SSH.
   - Pulls the new image and updates the container in the shared Docker
     Compose stack.
   - Reloads Caddy to serve the app at the new URL with TLS (via Let's Encrypt).
   - Mounts a named volume at `/data` for persistent installation storage.
3. Runs a verification job that confirms the deployment is live:
   - Waits for the health endpoint to return 200.
   - Verifies that unsigned POST requests to `/slack/events` return 401 (Bolt's
     signature validation).

Deployments are zero-downtime at the container level, but Slack may experience
brief buffering of events during the update. Slack automatically retries events
that time out.

### Logs and Retention

The bot logs to stdout, captured by the system's `journald` daemon. Logs are
retained for **at most 30 days** per the privacy policy. To view recent logs:

```sh
journalctl -t meatproxybot -n 100    # Last 100 lines
journalctl -t meatproxybot --since "2 hours ago"  # Last 2 hours
journalctl -t meatproxybot | grep error  # Errors only
```

The logs include all bot startup messages, errors, and audit entries (e.g.,
installation saves, deleted tokens).

### Installation Persistence

The bot stores OAuth installations in a SQLite database at `/data/installations.sqlite`.
The `/data` directory is a named volume that survives container restarts and
redeployments. **The volume is not automatically backed up by the VM.**

### Backup and Restore

The bot performs a nightly backup of the installations database to `/data/backups/`,
keeping the 7 most recent backup files. Backup failures are logged but never
crash the bot.

To restore an installation from backup:

```sh
# SSH to the VM
ssh -i ~/.ssh/deploy deploy@<hostname>

# Locate the desired backup file
ls -lt /var/lib/docker/volumes/meatproxybot_data/_data/backups/

# Restore from a specific backup (stop the container first)
docker-compose stop meatproxybot
cp /var/lib/docker/volumes/meatproxybot_data/_data/backups/installations-2026-09-15.sqlite \
   /var/lib/docker/volumes/meatproxybot_data/_data/installations.sqlite
docker-compose start meatproxybot
```

The backup files are simple SQLite copies and can also be inspected with
`sqlite3` for troubleshooting.

### Rollback

If a deployment breaks Slack request verification or introduces a critical bug,
two rollback paths are available:

**Option A (Fast, temporary):** Redeploy a known-good commit using `workflow_dispatch`:

```sh
# In the repo, click Actions → Deploy → Run workflow
# Choose the branch and commit SHA to deploy
# The deployment uses the git SHA as the image tag, so any previous commit can be redeployed
```

This keeps the bad commit on `main` but the bot runs an older version. The
rollback lasts until the next push to `main`.

**Option B (Sticky, permanent):** Revert the breaking commit on `main`:

```sh
git revert <breaking-commit-sha>
git push origin main
# Deployment runs automatically
```

This removes the bug from `main`. The reverted commit can later be re-applied
with a fix.

**Caveat:** Rollbacks to commits older than this ticket (before the deployment
infrastructure was added) will fail, because those versions lack the necessary
environment variables and configuration.

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

The only record of who triggered a callout is the bot's stdout audit log.
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

## Agents

Issues in the Linear project
[meatproxybot](https://linear.app/vguzman-test/project/meatproxybot-5f529c766fa9)
are worked by [Symphony](https://github.com/mscalessio/symphony-claude)
agents inside a Docker Sandboxes microVM. `WORKFLOW.md` tells them how to
work; `sandbox/README.md` covers setting the sandbox up.

Create it once from `main` with `sbx env run`, run `/login`, then exit.
From then on, `sbx env run -d` starts it detached, and Symphony starts on
its own. The dashboard is at <http://127.0.0.1:4547>.
