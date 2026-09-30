---
description: Push current branch changes to origin and create or update the corresponding pull request; use when asked to push, publish, or open a PR.
allowed-tools: Bash, Read, Grep, Glob
---

# Push

## Goals

- Safely push the current branch to origin.
- Create a new PR if none exists, or update the existing one.
- Ensure the PR is well-documented and correctly linked.

## Preconditions

- `gh` CLI is authenticated.
- Working tree is clean or changes are committed.

## Steps

1. Validate locally before pushing:
   - Run the project checks listed in `WORKFLOW.md` ("Repository facts").
   - If validation fails, fix issues and re-commit before pushing.
2. Push to origin:
   - `git push -u origin HEAD`
   - If push is rejected due to divergence, use the `pull` skill to sync first.
   - If push is rejected due to auth/permissions, surface the error directly —
     do not change remotes or protocol.
3. Never use bare `--force`. Only use `--force-with-lease` as a last resort
   when history was intentionally rewritten locally.
4. After pushing, check for an existing PR:
   - `gh pr view --json number,state,title,body`
   - If no PR exists, create one.
   - If a PR exists and is `OPEN`, update it.
   - If a PR exists and is `CLOSED`/`MERGED`, create a new branch if needed.
5. Creating a new PR:
   - Write a clear, human-friendly title that summarizes the shipped change.
   - Fill `.github/pull_request_template.md` completely if it exists —
     replace every placeholder comment with concrete content.
   - If no template exists, include: Summary, Changes, Test Plan sections.
   - `gh pr create --title "..." --body "..."`
6. Updating an existing PR:
   - Reconsider whether the current PR title still matches the latest scope;
     update it if it no longer does.
   - Refresh the PR body to reflect total scope rather than reusing a stale
     description.
   - `gh pr edit --title "..." --body "..."`
7. Ensure the PR has the `symphony` label:
   - `gh pr edit --add-label symphony`
8. Return the PR URL for linking.

## Failure handling

- Auth/permission failures: surface directly, do not retry with workarounds.
- Sync problems (non-fast-forward): delegate to the `pull` skill, then retry push.
- Network failures: retry once, then surface the error.
