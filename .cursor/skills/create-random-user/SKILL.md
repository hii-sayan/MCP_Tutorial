---
name: create-random-user
description: >-
  Calls the mcp-tutorial create-random-user MCP tool, then fetches users://all
  to display the newly created row. Use when the user runs /create-random_user,
  asks to create a random user, or wants a fake user added to the database.
disable-model-invocation: true
---

# Create Random User

## Goal

Add one random user via MCP, then show that row from the full user list.

## Prerequisites

- MCP server **mcp-tutorial** is enabled (see `.cursor/mcp.json`).
- Server is built: `npm run server:build` if `src/server.ts` changed recently.

## Workflow

1. **Read tool schema** (required): Check the `create-random-user` descriptor under the enabled `mcp-tutorial` MCP server before calling.

2. **Call the tool** via `CallMcpTool`:
   - **Server**: Use the connected server id for this project (often `project-0-mcp_tutorial-mcp-tutorial` or `mcp-tutorial` — match what appears in MCP settings).
   - **Tool**: `create-random-user`
   - **Arguments**: `{}` (no parameters)

3. **Check the tool result**:
   - Success text looks like: `User <id> created successfully`
   - On failure (`Failed to generate user data` / MCP unavailable): tell the user to restart the MCP server in Cursor settings and ensure `build/server.js` is up to date. Do not invent a user or write JSON unless they explicitly ask for a manual fallback.

4. **Fetch all users** via `FetchMcpResource`:
   - **URI**: `users://all`
   - Parse the JSON array.

5. **Show the new row**:
   - Prefer the user whose `id` matches the id from step 3.
   - If the id is missing from the message, use the **last** entry in the array (new users are appended).
   - Present as a small table: id, name, email, address, phone.

## Example output

After a successful run:

| Field | Value |
|-------|-------|
| id | 12 |
| name | … |
| email | … |
| address | … |
| phone | … |

Briefly confirm: tool status + that this row is now in `src/data/users.json`.
