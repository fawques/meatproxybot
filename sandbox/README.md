# Agent sandbox

Symphony runs agents with `--dangerously-skip-permissions`, so they run inside
a [Docker Sandboxes](https://docs.docker.com/ai/sandboxes/) microVM rather
than on a workstation. `sbxenv.yaml` at the repo root declares it, on top of
the stock claude image (Node 22, `gh` and git) with three kits:

- `kits/meatproxybot/` adds Linear access. Add the project's toolchain here
  once it has one.
- `kits/playwright/` lets agents download Playwright's browsers, so they
  can check UI changes in a real browser. It only opens the network; agents
  install the browser themselves.
- `kits/symphony/` builds [symphony-claude](https://github.com/mscalessio/symphony-claude)
  from a pinned commit and puts `symphony` on `PATH`. It is not on npm — the
  npm package called `symphony` is an unrelated React library, so never
  `npx symphony`. A supervisor it starts on every boot runs Symphony and
  keeps its `WORKFLOW.md` on `main`.

Requires an Apple silicon Mac on macOS 14+ (or Windows; see the Docker docs),
a Docker account, and a Linear personal API key. Docker Desktop is not needed.

## One-time setup per machine

```sh
brew trust docker/tap && brew install docker/tap/sbx
sbx login                    # Docker sign-in, opens a browser
sbx policy init balanced     # AI services, GitHub and npm; the kit adds Linear
sbx secret set linear        # paste the Linear key when prompted
gh auth login                # sbxenv.yaml reads `gh auth token` on the host
```

`sbx secret set linear` keeps the key in sbx's store on the host, not in the
repo. Do not put it in a `.env` here: see [What the agents can see](#what-the-agents-can-see).

## Create the sandbox and sign Claude in

From the repo root:

```sh
sbx env run
```

This creates `meatproxybot-agents` from `sbxenv.yaml` (showing a plan to approve
first) and attaches to Claude. Run `/login` once, then exit; the sandbox
keeps running, and the login lives in it until it is removed. To use an API
key instead of a Claude subscription, run `sbx secret set anthropic` before
creating it; then nothing needs signing in, and `sbx env run -d` creates it
without attaching.

From then on, start it detached: after `sbx stop`, a restart of the Mac or
anything else that stops the VM, run

```sh
sbx env run -d
```

It boots, and Symphony starts on its own (see [Run Symphony](#run-symphony)).
Nothing starts the VM when the Mac starts; this command does. Attach with
`sbx env run` only to use Claude in the sandbox yourself.

Agents can check UI changes in a real browser: the `playwright` kit allows
Playwright's download hosts, so `npx playwright install --with-deps chromium`
works inside. The browser itself is bound by the same policy, so pages it
opens can only reach allowlisted hosts, such as the Vite dev server on
localhost.

## Run Symphony

Nothing to do: the `symphony` kit starts a supervisor on every boot that
runs Symphony once Claude is logged in, so it starts as soon as `/login` is
done. Every minute the supervisor fast-forwards the sandbox's clone to
`origin/main`, which is where Symphony reads `WORKFLOW.md` from. When a
merge changes `WORKFLOW.md`, it restarts Symphony, but only once no agent is
running, claimed or waiting to retry, so no turn is cut off. It also
restarts Symphony if it exits.

Check on it from the host:

```sh
curl -s '127.0.0.1:4548/symphony.log?lines=100' # Symphony and supervisor log (the kit serves it)
curl -s 127.0.0.1:4548/symphony.log.1           # the previous log, once it rotated at 10 MB
curl -s 127.0.0.1:4547/api/v1/state             # running, claimed and retrying issues
```

Avoid `sbx env exec` on a sandbox that should keep running. It opens a
session, and sbx (v0.45.1) auto-stops the sandbox 30 seconds after its last
session disconnects, agents included; a sandbox started with `sbx env run -d`
has no session and stays up only until the first `exec` ends. If one did stop
it, wait until `sbx ls` shows it stopped before `sbx env run -d`: a restart
inside the 30-second grace period is stopped again when it expires. To stop
Symphony until the next boot, `sbx stop meatproxybot-agents`.

Do not also run `symphony WORKFLOW.md` by hand: a second instance would
fight the first over the dashboard port and dispatch the same issues. The
sandbox's clone is seeded from whatever branch the host repo was on at
creation, and the supervisor only updates it while it is on `main`; create
the sandbox from `main`, or `sbx env exec -- git switch main`. It never
merges anything but a fast-forward, so a dirty or diverged clone is left
alone and logged. Merged `WORKFLOW.md` changes reach agents within minutes,
including those the agents merge themselves.

`LINEAR_API_KEY` is already set inside the sandbox (as a placeholder the
proxy fills in). Symphony picks up issues in `Todo` from the Linear project
[meatproxybot](https://linear.app/vguzman-test/project/meatproxybot-5f529c766fa9)
in the Vguzman-test (VGU) team. It filters by project, not by team, so a VGU
issue outside that project is never picked up. Each agent clones the repo
from GitHub into `~/symphony-workspaces/meatproxybot` inside the VM and opens
PRs from there.

To have an agent question you about a ticket before it is worked, move it
from `Backlog` to `Grill Me`. The agent runs the `grilling` skill
(`.claude/skills/grilling`, from mattpocock/skills), keeps every round in one
`## Grill` comment, then moves the issue to `Awaiting Answers`. Reply with a
comment and move it back to `Grill Me` for the next round; Symphony only
dispatches by state, so a comment alone does not wake it. Once nothing is left
to ask, the agent posts the scope and acceptance criteria for you to confirm,
and after you do, returns the issue to `Backlog`.
Both states must exist in the VGU team's workflow, created once by hand;
give them the `backlog` type, like `Backlog`. The workflow also uses `Todo`,
`In Progress`, `In Review`, `Merging`, `Rework` and `Done`.

Agents label the issues they hold, so you can see at a glance in Linear which
ones are being worked. The three labels are flat team labels in one colour;
an agent recreates any that is missing.

| Label | Meaning | Added | Removed |
| --- | --- | --- | --- |
| `symphony-grilling` | An agent is grilling the issue. | First thing in a `Grill Me` run. | Right before the move to `Awaiting Answers` or `Backlog`. |
| `symphony-already-grilled` | You confirmed its Scope and Acceptance Criteria. If it enters `Grill Me` again, the agent @mentions whoever moved it there in the `## Grill` comment. | On the move to `Backlog` that ends grilling. | Never. |
| `symphony-implementing` | An agent is implementing or reworking the issue. | First thing in a `Todo`, `In Progress` or `Rework` run. | Right before the move to `In Review` or `Done`. |

A label left over by an interrupted run is removed the next time an agent
picks the issue up in a state where it does not belong.

The dashboard is published to <http://127.0.0.1:4547>
(4547 rather than Symphony's usual 4545, so it can run next to the ResViz
sandbox on 4545 and the Tria one on 4546). Symphony only listens on the VM's
loopback, which a published port cannot reach, so the `symphony` kit starts
a `socat` relay on every boot from sandbox port 4548 to it; `sbxenv.yaml`
publishes 4548. The kit also serves `~/symphony.log` on sandbox port 4549,
published to host `127.0.0.1:4548`.

## Day to day

```sh
sbx ls                               # is meatproxybot-agents running?
sbx env run -d                       # start it, detached; Symphony starts on its own
sbx env exec -- bash                 # shell in the sandbox; the sandbox auto-stops 30 s after you exit
sbx env run                          # attach to Claude interactively
sbx stop meatproxybot-agents         # stop, keeping its state
git fetch sandbox-meatproxybot-agents # bring back commits made in the sandbox's own clone
sbx env rm --force                   # delete it, with its sandbox-scoped secrets
```

After editing `sbxenv.yaml` or the kit, run `sbx env plan` to see what would
change. Kits, bindings and ports apply only when the sandbox is created, so
recreate it (`sbx env rm --force && sbx env run`) to pick them up. Fetch
`sandbox-meatproxybot-agents` first if anything in the sandbox's clone is unpushed:
removal deletes it.

## What the agents can see

- **Credentials: no.** The GitHub token and Linear key stay on the host; the
  sandbox proxy adds them to requests for GitHub and `api.linear.app` only.
  Inside, `LINEAR_API_KEY` reads `proxy-managed…`.
- **Your working tree: read-only.** Agents work on a private clone
  (`clone: true`), but sbx seeds it from the host repo mounted read-only at
  `/run/sandbox/source` — untracked files included. Keep secrets out of the
  repo directory.
- **The network: only what the policy allows.** `sbx policy ls meatproxybot-agents`
  lists it; `sbx policy allow network <host>` adds a host.

## Troubleshooting

- *"no binding authorizes linear — the credential was not injected"*: the
  `bindings:` block in `sbxenv.yaml` was not applied; recreate the sandbox.
- *Linear answers 401 inside the sandbox*: the key in sbx's store is wrong or
  revoked; `sbx secret set linear` again. Secrets apply to running sandboxes.
- *"global network policy has not been initialized"*: run
  `sbx policy init balanced`.
- *`symphony: command not found`*: the sandbox predates the `symphony` kit.
  Add it in place, keeping the Claude login:
  `sbx kit add meatproxybot-agents ./sandbox/kits/symphony`. Kit installs run only
  at creation, so after bumping its pinned commit, recreate the sandbox.
- *`npx playwright install` is blocked*: the sandbox predates the
  `playwright` kit. Add it in place: `sbx kit add meatproxybot-agents ./sandbox/kits/playwright`.
- *The sandbox keeps stopping by itself*: an `sbx env exec` session ended;
  see [Run Symphony](#run-symphony). `grep auto-stop` in
  `~/Library/Application Support/com.docker.sandboxes/sandboxes/sandboxd/daemon.log`
  shows it.
- *Symphony is not running* (dashboard unreachable): read the log with
  `curl -s 127.0.0.1:4548/symphony.log`. With no supervisor lines, Claude is
  not logged in yet (run `/login` in `sbx env run`), or the sandbox predates
  the supervisor or its `PATH` fix (`claude` not found under the startup
  hook's `PATH`); recreate it. If port 4548 does not answer either, the
  sandbox predates the log server; recreate it.
- *Merged `WORKFLOW.md` changes are not picked up*: the log says why, such
  as the clone not being on `main` or not fast-forwarding.
- *`npx symphony` fails*: it fetched the unrelated npm package; use `symphony`.
- `sbx diagnose` checks the installation.
