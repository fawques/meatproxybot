---
# Symphony (symphony-claude) orchestration for meatproxybot.
# Agents run with --dangerously-skip-permissions: only run the orchestrator
# inside the sandbox, never on a workstation. The sandbox runs it from its
# clone of main and restarts it when this file changes (see sandbox/README.md).
tracker:
  kind: linear
  # Linear project "meatproxybot" in the Vguzman-test (VGU) team
  # (https://linear.app/vguzman-test/project/meatproxybot-5f529c766fa9). Symphony
  # filters by project, not team: only VGU issues in this project are picked up.
  project_slug: "5f529c766fa9"
  # Backlog is ignored: move an issue to Todo to hand it to an agent, or to
  # Grill Me to have an agent question you until its scope is defined.
  # Awaiting Answers is deliberately neither active nor terminal: it parks a
  # grilled issue until you reply and move it back to Grill Me.
  # In Review is active: an agent reviews the PR and moves the issue back to
  # Todo to fix its comments, or on to Merging when nothing is left to fix.
  active_states:
    - Grill Me
    - Todo
    - In Progress
    - In Review
    - Merging
    - Rework
  terminal_states:
    - Closed
    - Cancelled
    - Canceled
    - Duplicate
    - Done

polling:
  interval_ms: 10000

workspace:
  root: ~/symphony-workspaces/meatproxybot

hooks:
  # Full clone, not shallow: agents merge origin/main into their branches.
  after_create: |
    git clone https://github.com/fawques/meatproxybot.git .
    npm ci
  before_run: |
    git fetch origin --prune
  timeout_ms: 300000

agent:
  max_concurrent_agents: 3
  max_turns: 20

codex:
  command: claude
  approval_policy: bypassPermissions
  stall_timeout_ms: 600000

server:
  port: 4547
---

You are working on a Linear ticket `{{ issue.identifier }}`

{% if attempt %}
Continuation context:

- This is retry attempt #{{ attempt }} because the ticket is still in an active state.
- Resume from the current workspace state instead of restarting from scratch.
- Do not repeat already-completed investigation or validation unless needed for new code changes.
- Do not end the turn while the issue remains in an active state unless you are blocked by missing required permissions/secrets.
{% endif %}

Issue context:
Identifier: {{ issue.identifier }}
Title: {{ issue.title }}
Current status: {{ issue.state }}
Labels: {{ issue.labels }}
URL: https://linear.app/issue/{{ issue.identifier }}

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

{% if issue.blockers.size > 0 %}
Blockers:
{% for blocker in issue.blockers %}
- {{ blocker.identifier }} ({{ blocker.state }})
{% endfor %}
{% endif %}

Instructions:

1. This is an unattended orchestration session. Never ask a human to perform follow-up actions.
2. Only stop early for a true blocker (missing required auth/permissions/secrets). If blocked, record it in the workpad and move the issue according to workflow.
3. Final message must report completed actions and blockers only. Do not include "next steps for user".

Work only in the provided repository copy. Do not touch any other path.

## meatproxybot repository facts

- Default branch is `main`. Branch from `origin/main` and name branches `{{ issue.identifier | downcase }}-<short-slug>`.
- Stack: TypeScript on Node 22.9+ with `@slack/bolt` in Socket Mode, Vitest, ESLint and Prettier. `npm ci` installs it (the `after_create` hook runs it).
- Required validation before every push: `npm run lint && npm run typecheck && npm test` (CI also runs `npm run build`). Tests use a mocked Slack client; agents get no Slack secrets, and the human smoke-tests in a real workspace.
- User-facing changes: verify the flow in a browser (Playwright if available) and attach a screenshot to the workpad.
- Never commit secrets or `.env`.
- Only merge from the `Merging` state, through the `land` skill. Only the review flow moves an issue to `Merging`.

## Prerequisite: `linear_graphql` MCP tool is available

Symphony provides a `linear_graphql` MCP tool to each agent session. Use it to read and update Linear issues, comments, states, and attachments. If the tool is not available, stop and report the blocker.

## Default posture

- Start by determining the ticket's current status, then follow the matching flow for that status.
- Start every task by opening the tracking workpad comment and bringing it up to date before doing new implementation work.
- Spend extra effort up front on planning and verification design before implementation.
- Reproduce first: always confirm the current behavior/issue signal before changing code so the fix target is explicit.
- Keep ticket metadata current (state, checklist, acceptance criteria, links).
- Treat a single persistent Linear comment as the source of truth for progress.
- Use that single workpad comment for all progress and handoff notes; do not post separate "done"/summary comments.
- Treat any ticket-authored `Validation`, `Test Plan`, or `Testing` section as non-negotiable acceptance input: mirror it in the workpad and execute it before considering the work complete.
- When meaningful out-of-scope improvements are discovered during execution,
  file a separate Linear issue instead of expanding scope. The follow-up issue
  must include a clear title, description, and acceptance criteria, be placed in
  `Todo` so an agent picks it up, be assigned to the same project as the current
  issue, link the current issue as `related`, and use `blockedBy` when the
  follow-up depends on the current issue (Symphony holds a `Todo` issue until
  all its blockers are done).
- Move status only when the matching quality bar is met.
- Operate autonomously end-to-end unless blocked by missing requirements, secrets, or permissions.
- Use the blocked-access escape hatch only for true external blockers (missing required tools/auth) after exhausting documented fallbacks.

## Related skills

- `linear`: interact with Linear via the `linear_graphql` MCP tool.
- `commit`: produce clean, logical commits during implementation.
- `push`: keep remote branch current and publish updates.
- `pull`: keep branch updated with latest `origin/main` before handoff.
- `land`: when ticket reaches `Merging`, follow the land skill flow.

## Status map

- `Backlog` -> out of scope for this workflow; do not modify.
- `Grill Me` -> planning requested; run the grill flow (the `grilling` skill). No code, branch or PR.
- `Awaiting Answers` -> a grill round or the final criteria are posted; waiting for the human to reply and move the issue back to `Grill Me`. Never dispatched.
- `Todo` -> queued; immediately transition to `In Progress` before active work.
  - Special case: if a PR is already attached, treat as feedback loop (run full PR feedback sweep, address or explicitly push back, revalidate, remove `symphony-implementing`, return to `In Review`). This is where the review flow sends issues with comments to fix.
- `In Progress` -> implementation actively underway.
- `In Review` -> PR is attached and validated; run the review flow (Step 3), which moves the issue to `Todo` (comments to fix) or `Merging` (nothing left to fix).
- `Merging` -> the review flow found nothing left to fix; execute the `land` skill flow (do not call `gh pr merge` directly).
- `Rework` -> a human requested a full approach reset; planning + implementation required.
- `Done` -> terminal state; no further action required.

## Linear state labels

Three team labels make it visible in Linear that an agent holds an issue. They are flat labels in the issue's team (no label group), all in the same colour, and prefixed `symphony-` so a human does not mistake them for their own:

- `symphony-grilling`: an agent is grilling the issue. Added as the first Linear action of the Grill flow; removed right before every move out of `Grill Me` (to `Awaiting Answers` or `Backlog`).
- `symphony-already-grilled`: the human confirmed the grilled Scope and Acceptance Criteria. Added on the move to `Backlog` that ends grilling. Never removed.
- `symphony-implementing`: an agent is implementing the issue. Added as the first Linear action in `Todo` (right after the move to `In Progress`), `In Progress` and `Rework`, including the Todo-with-PR feedback loop. Removed right before every move to `In Review`, to `Backlog` (the blocked-access escape hatch) or to `Done`. `In Review` and `Merging` get no label.

Rules:

- Change labels only with `issueAddLabel(id, labelId)` / `issueRemoveLabel(id, labelId)`. Never set `labelIds` through `issueUpdate`: it replaces the issue's whole label set and would drop the human's labels.
- Look the label up by name in the issue's team (`issueLabels(filter: {name: {eq: "<name>"}, team: {id: {eq: "<teamId>"}}})`). If it is missing, create it with `issueLabelCreate` in that team, with no parent and the same colour as the other `symphony-` labels (`#5E6AD2` if none exists).
- A failed label call, including creating a missing label, is never a blocker. Note it in the workpad (or the `## Grill` comment while grilling) and carry on.
- States that are terminal or never dispatched (`Backlog`, `Done`, `Canceled`, `Duplicate`, `Awaiting Answers`) get no labelling, except the removal on the move into them.
- Adding a label that is already on the issue, or removing one that is not, is harmless; do not check first.

## Step 0: Determine current ticket state and route

1. Fetch the issue using the `linear_graphql` MCP tool by explicit ticket ID.
2. Read the current state and labels, then reconcile stale labels left by an interrupted run (see `Linear state labels`):
   - Remove `symphony-grilling` if the state is not `Grill Me`.
   - Remove `symphony-implementing` if the state is not `Todo`, `In Progress` or `Rework`.
   - Never touch `symphony-already-grilled` or any other label.
3. Route to the matching flow:
   - `Backlog` -> do not modify issue content/state; stop and wait for human to move it to `Todo`.
   - `Grill Me` -> follow the grill flow below and skip every other step, including step 4.
   - `Todo` -> immediately move to `In Progress`, add `symphony-implementing`, then ensure bootstrap workpad comment exists (create if missing), then start execution flow.
     - If PR is already attached, start by reviewing all open PR comments and deciding required changes vs explicit pushback responses.
   - `In Progress` -> add `symphony-implementing`, then continue execution flow from current workpad comment.
   - `In Review` -> follow the review flow (Step 3) and skip steps 4 and 5. Do not change code.
   - `Merging` -> follow the `land` skill flow; do not call `gh pr merge` directly.
   - `Rework` -> add `symphony-implementing`, then run rework flow.
   - `Done` -> do nothing and shut down.
4. Check whether a PR already exists for the current branch and whether it is closed.
   - If a branch PR exists and is `CLOSED` or `MERGED`, treat prior branch work as non-reusable for this run.
   - Create a fresh branch from `origin/main` and restart execution flow as a new attempt.
5. For `Todo` tickets, do startup sequencing in this exact order:
   - Update issue state to `In Progress` via `linear_graphql`
   - Add the `symphony-implementing` label
   - Find/create `## Workpad` bootstrap comment
   - Only then begin analysis/planning/implementation work.
6. Add a short comment if state and issue content are inconsistent, then proceed with the safest flow.

## Grill flow (Grill Me)

Run the `grilling` skill (`.claude/skills/grilling`) on the ticket. The skill decides what to ask and how; the rules below only adapt it to an unattended session where the human answers by commenting on the Linear issue.

0. As the first Linear action, add the `symphony-grilling` label. If the issue already has `symphony-already-grilled`, it is being grilled again after its criteria were confirmed: flag it, then carry on grilling.
   - Find who moved it back: the newest entry of `issue.history` (newest first) whose `toState.name` is `Grill Me`, and its `actor`. If there is no such entry or no actor, use the issue `creator`.
   - Put a callout at the top of the `## Grill` comment, right under the header, that mentions that user by their profile `url` (a Linear profile link renders as a mention), for example: `> ⚠️ <url> This issue was already grilled and its criteria confirmed. Grilling again; the new round may change the agreed Scope and Acceptance Criteria.` Keep a single callout; update it on later rounds rather than adding another.
1. Keep every round in a single persistent comment headed `## Grill`, found or created the same way as the workpad (reuse an unresolved one; never create a second). Edit it in place: the current round's questions in the skill's format, and below them an `### Answered` log of each earlier question and the human's reply. It is the only comment you write during grilling. Do not create a `## Workpad` comment and do not edit the issue description.
2. Each run is one round. Read the issue, every comment (including replies in the `## Grill` thread) and the code the ticket touches, then record the new answers in `### Answered` and recompute the frontier.
3. Where the skill says to wait for the user's answers, remove `symphony-grilling`, move the issue to `Awaiting Answers` instead, then end the turn. The human replies and moves it back to `Grill Me` for the next round.
4. When the frontier is empty, write `### Scope` and an `### Acceptance Criteria` checklist (with how each criterion is validated) into the `## Grill` comment, ask the human to confirm them, remove `symphony-grilling`, and move the issue to `Awaiting Answers`.
5. When the human has confirmed the Scope and Acceptance Criteria, add `symphony-already-grilled`, remove `symphony-grilling`, and move the issue to `Backlog`. The human moves it to `Todo` when they want it worked.
6. No code, branch or PR during grilling.
7. Change state only as your last action: moving the issue out of `Grill Me` stops this session, so anything after it is lost. That is why every label change comes before the state change.

## Step 1: Start/continue execution (Todo or In Progress)

1.  Find or create a single persistent workpad comment for the issue:
    - Search existing comments via `linear_graphql` for a marker header: `## Workpad`.
    - Ignore resolved comments while searching; only active/unresolved comments are eligible to be reused as the live workpad.
    - If found, reuse that comment; do not create a new workpad comment.
    - If not found, create one workpad comment and use it for all updates.
    - Persist the workpad comment ID and only write progress updates to that ID.
2.  If arriving from `Todo`, do not delay on additional status transitions: the issue should already be `In Progress` before this step begins.
3.  Immediately reconcile the workpad before new edits:
    - Check off items that are already done.
    - Expand/fix the plan so it is comprehensive for current scope.
    - Ensure `Acceptance Criteria` and `Validation` are current and still make sense for the task.
4.  Start work by writing/updating a hierarchical plan in the workpad comment.
5.  Ensure the workpad includes a compact environment stamp at the top as a code fence line:
    - Format: `<host>:<abs-workdir>@<short-sha>`
    - Example: `devbox-01:/home/dev-user/symphony-workspaces/MT-32@7bdde33bc`
    - Do not include metadata already inferable from Linear issue fields (`issue ID`, `status`, `branch`, `PR link`).
6.  Add explicit acceptance criteria and TODOs in checklist form in the same comment.
    - If changes are user-facing, include a UI walkthrough acceptance criterion that describes the end-to-end user path to validate.
    - If changes touch app files or app behavior, add explicit app-specific flow checks to `Acceptance Criteria` in the workpad.
    - If the ticket description/comment context includes `Validation`, `Test Plan`, or `Testing` sections, copy those requirements into the workpad `Acceptance Criteria` and `Validation` sections as required checkboxes (no optional downgrade).
    - If the issue has a `## Grill` comment, its `Scope` and `Acceptance Criteria` were agreed with the human: copy them into the workpad as required checkboxes, and treat later human comments as overriding them.
7.  Run a principal-style self-review of the plan and refine it in the comment.
8.  Before implementing, capture a concrete reproduction signal and record it in the workpad `Notes` section (command/output, screenshot, or deterministic UI behavior).
9.  Run the `pull` skill to sync with latest `origin/main` before any code edits, then record the pull/sync result in the workpad `Notes`.
    - Include a `pull skill evidence` note with:
      - merge source(s),
      - result (`clean` or `conflicts resolved`),
      - resulting `HEAD` short SHA.
10. Compact context and proceed to execution.

## PR feedback sweep protocol (required)

When a ticket has an attached PR, run this protocol before moving to `In Review`:

1. Identify the PR number from issue links/attachments.
2. Gather feedback from all channels:
   - Top-level PR comments (`gh pr view --comments`).
   - Inline review comments (`gh api repos/<owner>/<repo>/pulls/<pr>/comments`).
   - Review summaries/states (`gh pr view --json reviews`).
3. Treat every actionable reviewer comment (human or bot), including inline review comments, as blocking until one of these is true:
   - code/test/docs updated to address it, or
   - explicit, justified pushback reply is posted on that thread.
4. Update the workpad plan/checklist to include each feedback item and its resolution status.
5. Re-run validation after feedback-driven changes and push updates.
6. Repeat this sweep until there are no outstanding actionable comments.

## Blocked-access escape hatch (required behavior)

Use this only when completion is blocked by missing required tools or missing auth/permissions that cannot be resolved in-session.

- GitHub is **not** a valid blocker by default. Always try fallback strategies first (alternate remote/auth mode, then continue publish/review flow).
- Do not move to `In Review` for GitHub access/auth until all fallback strategies have been attempted and documented in the workpad.
- If a non-GitHub required tool is missing, or required non-GitHub auth is unavailable, remove `symphony-implementing` and move the ticket to `Backlog` (never dispatched, so it stays parked until a human unblocks it and moves it to `Todo`) with a short blocker brief in the workpad that includes:
  - what is missing,
  - why it blocks required acceptance/validation,
  - exact human action needed to unblock.
- Keep the brief concise and action-oriented; do not add extra top-level comments outside the workpad.

## Step 2: Execution phase (Todo -> In Progress -> In Review)

1.  Determine current repo state (`branch`, `git status`, `HEAD`) and verify the kickoff `pull` sync result is already recorded in the workpad before implementation continues.
2.  If current issue state is `Todo`, move it to `In Progress`; otherwise leave the current state unchanged. Either way, make sure `symphony-implementing` is on the issue.
3.  Load the existing workpad comment and treat it as the active execution checklist.
    - Edit it liberally whenever reality changes (scope, risks, validation approach, discovered tasks).
4.  Implement against the hierarchical TODOs and keep the comment current:
    - Check off completed items.
    - Add newly discovered items in the appropriate section.
    - Keep parent/child structure intact as scope evolves.
    - Update the workpad immediately after each meaningful milestone.
    - Never leave completed work unchecked in the plan.
    - For tickets that started as `Todo` with an attached PR, run the full PR feedback sweep protocol immediately after kickoff and before new feature work.
5.  Run validation/tests required for the scope.
    - Mandatory gate: execute all ticket-provided `Validation`/`Test Plan`/`Testing` requirements when present; treat unmet items as incomplete work.
    - Prefer a targeted proof that directly demonstrates the behavior you changed.
    - You may make temporary local proof edits to validate assumptions when this increases confidence.
    - Revert every temporary proof edit before commit/push.
    - Document these temporary proof steps and outcomes in the workpad `Validation`/`Notes` sections so reviewers can follow the evidence.
6.  Re-check all acceptance criteria and close any gaps.
7.  Before every `git push` attempt, run the required validation for your scope and confirm it passes; if it fails, address issues and rerun until green, then commit and push changes.
8.  Attach PR URL to the issue (prefer attachment via `linear_graphql`; use the workpad comment only if attachment is unavailable).
    - Ensure the GitHub PR has label `symphony` (add it if missing).
9.  Merge latest `origin/main` into branch, resolve conflicts, and rerun checks.
10. Update the workpad comment with final checklist status and validation notes.
    - Mark completed plan/acceptance/validation checklist items as checked.
    - Add final handoff notes (commit + validation summary) in the same workpad comment.
    - Do not include PR URL in the workpad comment; keep PR linkage on the issue via attachment/link fields.
    - Add a short `### Confusions` section at the bottom when any part of task execution was unclear/confusing, with concise bullets.
    - Do not post any additional completion summary comment.
11. Before moving to `In Review`, poll PR feedback and checks:
    - Run the full PR feedback sweep protocol.
    - Confirm PR checks are passing (green) after the latest changes.
    - Confirm every required ticket-provided validation/test-plan item is explicitly marked complete in the workpad.
    - Repeat this check-address-verify loop until no outstanding comments remain and checks are fully passing.
    - Re-open and refresh the workpad before state transition so `Plan`, `Acceptance Criteria`, and `Validation` exactly match completed work.
12. Only then remove `symphony-implementing` and move issue to `In Review`.
    - Exception: if blocked by missing required non-GitHub tools/auth per the blocked-access escape hatch, remove `symphony-implementing` and move to `Backlog` with the blocker brief and explicit unblock actions.
13. For `Todo` tickets that already had a PR attached at kickoff:
    - Ensure all existing PR feedback was reviewed and resolved, including inline review comments (code changes or explicit, justified pushback response).
    - Ensure branch was pushed with any required updates.
    - Then remove `symphony-implementing` and move to `In Review`.

## Step 3: Review flow (In Review) and merge handling

In `In Review` you are the reviewer, not the implementer: do not change code, commit, push, or edit the issue description. Each run is one review round.

1. Identify the PR from the issue attachments. If none is attached, or it is `CLOSED`/`MERGED`, add a short note to the workpad and move the issue to `Todo`.
2. Check out the PR branch and read, in full:
   - the issue, every comment, the workpad (its `Acceptance Criteria` and `Validation`) and any `## Grill` Scope and Acceptance Criteria;
   - the PR diff against `origin/main`;
   - all existing PR feedback, through every channel of the PR feedback sweep protocol, including replies;
   - the PR checks on the latest commit.
3. Review the diff for correctness, and against the acceptance criteria and the `meatproxybot repository facts` above. Report only actionable findings: bugs, unmet acceptance criteria, missing or failing validation, rule violations. No style preferences.
4. Do not re-raise a thread that was fixed in code or answered with a justified pushback reply. Re-raise only when the fix is wrong or incomplete, saying why on that thread.
5. Post all new findings as one GitHub PR review with inline comments on the relevant lines (`gh api repos/fawques/meatproxybot/pulls/<pr>/reviews` with `event: COMMENT`; GitHub rejects `REQUEST_CHANGES` and `APPROVE` from the PR's own author, which the agents' GitHub identity is). Post nothing when there are no new findings.
6. Add one line to the workpad `Notes`: the review round's time, head short SHA, and the number of new findings and still-open threads.
7. Decide, then change state as your last action (moving the issue out of `In Review` stops this session, so anything after it is lost):
   - New findings, any actionable thread (human or bot) neither fixed nor answered with a justified pushback, or failing checks -> move the issue to `Todo`. The Todo-with-PR flow fixes them and returns it to `In Review`.
   - Otherwise, nothing is left to fix -> move the issue to `Merging`.
8. When the issue is in `Merging`, follow the `land` skill flow. Do not call `gh pr merge` directly.
9. After merge is complete, remove `symphony-implementing` (normally already gone) and move the issue to `Done`.

## Step 4: Rework handling

1. Treat `Rework` as a full approach reset, not incremental patching.
2. Re-read the full issue body and all human comments; explicitly identify what will be done differently this attempt.
3. Close the existing PR tied to the issue.
4. Remove the existing `## Workpad` comment from the issue.
5. Create a fresh branch from `origin/main`.
6. Start over from the normal kickoff flow:
   - If current issue state is `Todo`, move it to `In Progress`; otherwise keep the current state.
   - Make sure `symphony-implementing` is on the issue.
   - Create a new bootstrap `## Workpad` comment.
   - Build a fresh plan/checklist and execute end-to-end.

## Completion bar before In Review

- Step 1/2 checklist is fully complete and accurately reflected in the single workpad comment.
- Acceptance criteria and required ticket-provided validation items are complete.
- Validation/tests are green for the latest commit.
- PR feedback sweep is complete and no actionable comments remain.
- PR checks are green, branch is pushed, and PR is linked on the issue.
- Required PR metadata is present (`symphony` label).
- `symphony-implementing` is removed right before the move to `In Review`.

## Guardrails

- If the branch PR is already closed/merged, do not reuse that branch or prior implementation state for continuation.
- For closed/merged branch PRs, create a new branch from `origin/main` and restart from reproduction/planning as if starting fresh.
- If issue state is `Backlog`, do not modify it; wait for human to move to `Todo`.
- Do not edit the issue body/description for planning or progress tracking.
- Use exactly one persistent workpad comment (`## Workpad`) per issue.
- Temporary proof edits are allowed only for local verification and must be reverted before commit.
- If out-of-scope improvements are found, create a separate `Todo` issue rather
  than expanding current scope, and include a clear
  title/description/acceptance criteria, same-project assignment, a `related`
  link to the current issue, and `blockedBy` when the follow-up depends on the
  current issue.
- Do not move to `In Review` unless the `Completion bar before In Review` is satisfied.
- In `In Review`, do not change code; only review, comment on the PR, and move the issue to `Todo` or `Merging`.
- If state is terminal (`Done`), do nothing and shut down.
- Keep issue text concise, specific, and reviewer-oriented.
- If blocked and no workpad exists yet, add one blocker comment describing blocker, impact, and next unblock action.

## Workpad template

Use this exact structure for the persistent workpad comment and keep it updated in place throughout execution:

````md
## Workpad

```text
<hostname>:<abs-path>@<short-sha>
```

### Plan

- [ ] 1\. Parent task
  - [ ] 1.1 Child task
  - [ ] 1.2 Child task
- [ ] 2\. Parent task

### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

### Validation

- [ ] targeted tests: `<command>`

### Notes

- <short progress note with timestamp>

### Confusions

- <only include when something was confusing during execution>
````
