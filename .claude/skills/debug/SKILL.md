---
description: Debug stuck or failing Symphony runs by correlating Linear identifiers with log entries and tracing agent session lifecycles; use when investigating why a run failed, stalled, or retried.
allowed-tools: Bash, Read, Grep, Glob
---

# Debug

## Overview

This skill helps investigate why Symphony runs become stuck, retry excessively,
or fail. It works by correlating Linear issue identifiers with structured log
entries (pino JSON format) and tracing agent session lifecycles.

## Correlation identifiers

Three keys link issues to log entries:

| Key | Format | Example |
|-----|--------|---------|
| `issue_identifier` | Human ticket key | `MT-625` |
| `issue_id` | Linear internal UUID | `a1b2c3d4-...` |
| `session_id` | Claude session ID | `abc123def456` |

Always pair session findings with `issue_identifier`/`issue_id` to avoid
mixing up concurrent runs of different issues.

## Triage protocol

Follow these steps in order:

### 1. Confirm symptoms

- What is the reported behavior? (stuck, erroring, retrying, silent)
- When did it start? (timestamp or approximate time)
- Is it one issue or many?

### 2. Locate the ticket in logs

Use `Grep` to search structured logs by identifier (fastest entry point):

```
Grep pattern: "MT-625" in log files
```

For pino JSON logs, the identifier appears in the `identifier` or
`issue_identifier` fields of log objects.

### 3. Extract session data

From matching log lines, pull `session_id` values. A single issue may have
multiple sessions across retries — distinguish them by timestamp and attempt
number.

### 4. Trace the session lifecycle

Follow the session through its stages:
- **Start**: Look for `"Spawning claude turn"` or `"Starting claude turn"` entries
- **Events**: Stream events with `type: "system"`, `type: "assistant"`, `type: "result"`
- **Completion**: `"Turn completed successfully"` or error entries
- **State check**: `"Issue no longer in active state"` or `"Max turns reached"`

### 5. Classify the failure

| Type | Signal |
|------|--------|
| **Stall/timeout** | `"Turn timeout reached"` or `"stall_timeout"` entries; no events for extended period |
| **Startup failure** | `"Failed to spawn claude process"` or immediate exit without system event |
| **Turn failure** | `"Turn failed"` with error message; check stderr output |
| **Retry loop** | Multiple sessions for same issue with increasing attempt numbers |
| **Worker crash** | Process error entries, abort signals |
| **Hook failure** | `"before_run hook failed"` or `"after_create"` errors |

### 6. Check orchestrator state

Use the HTTP API if available:
- `GET /api/v1/state` — full snapshot of running, retry queue, completed sets
- `GET /api/v1/<identifier>` — issue-specific details

## Log sources

- Primary: stdout (pino structured JSON logs)
- The orchestrator logs with components: `orchestrator`, `linear`, `http`, `watcher`
- Agent runners log with `issue_identifier`, `turn`, `sessionId` fields

## Key log patterns to search for

```
"Issue stalled"
"scheduling retry"
"turn_timeout"
"Turn failed"
"session failed"
"session ended with error"
"Aborted"
"Max turns reached"
"Workspace creation failed"
"before_run hook failed"
"Config validation failed"
```

## Common root causes

1. **Stall loops**: Agent produces no output for `stall_timeout_ms` — often
   caused by the agent waiting for user input it won't receive. Check the prompt
   template for conditions that might cause the agent to pause.

2. **Startup failures**: Claude CLI not found or not authenticated. Verify
   `which claude` and `claude --version` on the execution host.

3. **Turn failures**: Usually model errors or tool failures. Check the stderr
   output in debug-level logs.

4. **Workspace hook failures**: `after_create` hook failing (e.g., git clone
   failing due to auth). Verify the hook command works standalone.

5. **Linear API errors**: Rate limits or auth issues with the `linear_graphql`
   MCP tool. Check for HTTP 429 or 401 in tool responses.

## Tips

- Use `Grep` with the `Glob` pattern `"*.log"` to search log files — do not
  shell out to `grep` or `rg`.
- For recent runs, check orchestrator stdout directly.
- Cross-reference the issue's Linear timeline (comments, state changes) with
  log timestamps to reconstruct what happened.
