# meatproxybot

don't be a meat proxy

## Agents

Issues in the Linear project
[meatproxybot](https://linear.app/vguzman-test/project/meatproxybot-5f529c766fa9)
are worked by [Symphony](https://github.com/mscalessio/symphony-claude)
agents inside a Docker Sandboxes microVM. `WORKFLOW.md` tells them how to
work; `sandbox/README.md` covers setting the sandbox up.

Create it once from `main` with `sbx env run`, run `/login`, then exit.
From then on, `sbx env run -d` starts it detached, and Symphony starts on
its own. The dashboard is at <http://127.0.0.1:4547>.
