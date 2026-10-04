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

## Public Pages for Marketplace Listing

The following pages are publicly accessible at stable URLs and required for marketplace submission:

- **Landing page**: `https://fawques.github.io/meatproxybot/` — describes the bot and links to privacy and support pages.
- **Privacy policy**: `https://fawques.github.io/meatproxybot/privacy/` — covers data collection, use, retention, rights, and contact for data requests.
- **Support page**: `https://fawques.github.io/meatproxybot/support/` — contact information and FAQ.

## Before Submission (Human-Only Checklist)

Before submitting to the Slack Marketplace, complete the following human-only steps:

1. **Set the support and data-request email address**:
   Replace `SUPPORT_EMAIL` in `site/` with your actual email:

   ```bash
   sed -i -e 's/SUPPORT_EMAIL/your-email@example.com/g' site/**/*.html
   ```

2. **Set the controller country**:
   Replace `CONTROLLER_COUNTRY` in `site/` with your country:

   ```bash
   sed -i -e 's/CONTROLLER_COUNTRY/your-country/g' site/**/*.html
   ```

3. **Set the bot base URL**:
   Replace `BOT_BASE_URL` in `site/` with the actual bot's base URL (typically `https://api.<domain>/meatproxybot`):

   ```bash
   sed -i -e 's|BOT_BASE_URL|https://api.<domain>/meatproxybot|g' site/**/*.html
   ```

4. **Verify the submission is ready**:

   ```bash
   npm run check:submission
   ```

   This command fails if any placeholders remain.

5. **Review the privacy policy** against `src/callOut.ts` and `src/installationStore.ts` to confirm all data fields are correctly listed.

6. **Test the pages locally**:
   Open `site/index.html` in your browser and verify all links work (after running the `sed` command above).

7. **Verify GitHub Pages deployment**:
   After merging, confirm the site is live at `https://fawques.github.io/meatproxybot/`.

---

## Marketplace Submission Checklist

This section tracks the status of all requirements for Slack Marketplace submission.

### Listing Assets

| Requirement       | Status                   | Notes                                                                                          |
| ----------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| Icon              | ✅ Complete              | `docs/marketplace/icon.png` (1024×1024, 5.3 KB)                                                |
| Short description | ✅ Complete              | "Nudge teammates to read AI-generated text before they paste it." (10 words) in `manifest.yml` |
| Long description  | ✅ Complete              | 175–4000 characters in `manifest.yml` display_information.long_description                     |
| Screenshots (3×)  | ✅ Complete              | 1600×1000 PNG files under 2 MB each in `docs/marketplace/`                                     |
| Video             | ❌ Optional, not planned | Listed as optional in marketplace requirements                                                 |

### Listing Copy

| Requirement                | Status      | Notes                                               |
| -------------------------- | ----------- | --------------------------------------------------- |
| Manifest short description | ✅ Complete | `manifest.yml` display_information.description      |
| Manifest long description  | ✅ Complete | `manifest.yml` display_information.long_description |
| README aligned             | ✅ Complete | Updated tagline and description                     |
| package.json aligned       | ✅ Complete | Updated description field                           |

### URLs and Documentation

| Requirement          | Status      | Notes                                                                                         |
| -------------------- | ----------- | --------------------------------------------------------------------------------------------- |
| Landing page         | ✅ Complete | https://fawques.github.io/meatproxybot/ (GitHub Pages)                                        |
| Privacy policy       | ✅ Complete | https://fawques.github.io/meatproxybot/privacy/ (GitHub Pages)                                |
| Support page         | ✅ Complete | https://fawques.github.io/meatproxybot/support/ (GitHub Pages)                                |
| Scope justifications | ✅ Complete | See "Scope Mapping Table" section above (VGU-62)                                              |
| Hosting details      | ✅ Complete | Hosted on owner's shared GCP VM with URLs under `https://api.<domain>/meatproxybot/` (VGU-64) |

### Human-Only Steps (Not Automated)

The following steps require human action and cannot be automated:

1. **Icon Approval** (PENDING)
   - [ ] Review the generated icon at `docs/marketplace/icon.png`
   - [ ] Approve or replace with custom artwork if desired

2. **Real Screenshots** (PENDING)
   - [ ] Replace mock screenshots with real Slack workspace captures
   - [ ] Three captures required: one per trigger (reaction, shortcut, /meatproxy)
   - [ ] Each must be exactly 1600×1000 PNG under 2 MB
   - [ ] Update files: `screenshot-reaction.png`, `screenshot-shortcut.png`, `screenshot-slash.png`

3. **Collaborator** (PENDING)
   - [ ] Add a collaborator to the app at https://api.slack.com/apps

4. **Minimum Eligibility: 10 Active Workspaces & 10 Weekly Active Users** (PENDING)
   - [ ] Install the bot on at least 10 active workspaces
   - [ ] Reach at least 10 weekly active users combined
   - Check progress with `npm run stats` (see README, "Usage statistics")
   - Workspaces:
     - [ ] Workspace 1: (add name when ready to submit)
     - [ ] Workspace 2: (add name when ready to submit)
     - [ ] Workspace 3: (add name when ready to submit)
     - [ ] Workspace 4: (add name when ready to submit)
     - [ ] Workspace 5: (add name when ready to submit)
     - [ ] Workspace 6: (add name when ready to submit)
     - [ ] Workspace 7: (add name when ready to submit)
     - [ ] Workspace 8: (add name when ready to submit)
     - [ ] Workspace 9: (add name when ready to submit)
     - [ ] Workspace 10: (add name when ready to submit)

5. **Submit to Marketplace** (PENDING)
   - [ ] Fill in app listing at https://api.slack.com/apps/{APP_ID}/submission
   - [ ] Upload icon and screenshots
   - [ ] Submit the listing for review
