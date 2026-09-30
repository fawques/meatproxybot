---
description: Interact with Linear via the linear_graphql MCP tool for issue queries, state transitions, comments, and attachments; use when asked to read or update Linear data.
allowed-tools: Bash, Read, Grep, Glob
---

# Linear

## Overview

Symphony provides each agent session with a `linear_graphql` MCP tool that
executes raw GraphQL queries and mutations against the Linear API. Use this
tool for all Linear operations — do not use shell scripts or HTTP calls to
access Linear directly.

## Tool interface

```json
{
  "name": "linear_graphql",
  "input": {
    "query": "GraphQL query or mutation string",
    "variables": { "optional": "variables object" }
  }
}
```

Send one GraphQL operation per tool call. Treat a top-level `errors` array in
the response as a failed operation even if the tool call itself completed.

## Common operations

### Issue lookup

Preferred lookup order (fastest to slowest):

1. By key (e.g., `MT-686`):
   ```graphql
   query { issue(id: "MT-686") { id identifier title state { name } description } }
   ```

2. By identifier filter:
   ```graphql
   query { issues(filter: { identifier: { eq: "MT-686" } }) { nodes { id identifier title state { name } } } }
   ```

3. By internal ID for narrow reads when you already have the UUID.

### State transitions

Always fetch team workflow states before transitioning — do not hardcode state IDs:

```graphql
query {
  issue(id: "MT-686") {
    team { states { nodes { id name } } }
  }
}
```

Then update:
```graphql
mutation {
  issueUpdate(id: "<issue-uuid>", input: { stateId: "<state-uuid>" }) {
    success
    issue { id state { name } }
  }
}
```

### Comments

Create a comment:
```graphql
mutation {
  commentCreate(input: { issueId: "<issue-uuid>", body: "## Workpad\n..." }) {
    success
    comment { id body }
  }
}
```

Update an existing comment:
```graphql
mutation {
  commentUpdate(id: "<comment-uuid>", input: { body: "updated body" }) {
    success
    comment { id body }
  }
}
```

### Attachments

Link a GitHub PR to an issue:
```graphql
mutation {
  attachmentLinkGitHubPR(issueId: "<issue-uuid>", url: "https://github.com/owner/repo/pull/123") {
    success
    attachment { id }
  }
}
```

Generic URL attachment:
```graphql
mutation {
  attachmentCreate(input: { issueId: "<issue-uuid>", url: "https://...", title: "..." }) {
    success
    attachment { id }
  }
}
```

### File uploads

Three-step process:

1. Request upload credentials:
   ```graphql
   mutation { fileUpload(contentType: "image/png", filename: "screenshot.png", size: 12345) {
     success uploadFile { uploadUrl assetUrl headers { key value } }
   }}
   ```

2. Upload the file bytes to the returned `uploadUrl` via HTTP PUT with the
   provided headers (use Bash `curl`).

3. Reference the `assetUrl` in a comment body (e.g., as a markdown image).

## Usage principles

- Use `linear_graphql` for all Linear operations: comment edits, uploads, state
  transitions, and ad-hoc queries.
- Keep queries narrowly scoped — request only the fields you need.
- When encountering an unfamiliar mutation, use introspection to discover the
  schema:
  ```graphql
  { __type(name: "IssueMutation") { fields { name args { name type { name } } } } }
  ```
- Prefer `attachmentLinkGitHubPR` over generic `attachmentCreate` for PR links.
- Do not introduce shell helpers for GraphQL access — always use the MCP tool.
- Shell work is limited to signed upload URLs returned by the API.
