# MCP client setup (Claude Desktop)

Configure Claude Desktop to query your team wiki via the MCP server.

**MCP endpoint:** `http://your-server:3334/mcp` (Streamable HTTP, current MCP spec)

---

## Step 1 — Issue an MCP token

1. Open the admin UI (`http://localhost:3000` in dev, or your production URL)
2. Sign in with Google or GitHub
3. Navigate to **Account → API Tokens → New Token**
4. Enter a label (e.g. `claude-desktop-laptop`) and click **Create**
5. **Copy the plaintext token immediately** — it is shown only once. Format: `wkt_<32 base62 chars>`

If you miss it, revoke and create a new one.

---

## Step 2 — Configure Claude Desktop

Find your Claude Desktop config file:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |

Add or merge the following into the `mcpServers` object:

```json
{
  "mcpServers": {
    "wiki-team": {
      "url": "http://localhost:3334/mcp",
      "headers": {
        "Authorization": "Bearer wkt_<your-token-here>"
      }
    }
  }
}
```

For a production server, replace `http://localhost:3334` with your server URL (must be HTTPS in production — see [deployment-docker-compose.md](deployment-docker-compose.md) for TLS setup).

**Full annotated example** (bridge mode with personal skills also wired):
See [`apps/wiki-skills/integrations/team-bridge/example-claude-desktop.json`](../../apps/wiki-skills/integrations/team-bridge/example-claude-desktop.json).

---

## Step 3 — Restart Claude Desktop

Fully quit and relaunch Claude Desktop. The `wiki-team` MCP server should appear in the tool list.

---

## Step 4 — Verify the connection

In a Claude Desktop conversation, ask:

> "List my wiki workspaces."

Claude should call `workspace.info` and return your workspace name. If it errors, check:

1. MCP server is running (`bun run team:dev` or production server)
2. Token is valid (not expired, not revoked — check admin UI)
3. URL and port are correct
4. No firewall blocking port 3334

---

## Available MCP tools

| Tool | What it does | Scope |
|---|---|---|
| `wiki.search` | Semantic + keyword search across notes | Workspace-scoped |
| `wiki.fetch` | Fetch a specific note by slug | Workspace-scoped |
| `wiki.catalog` | List all notes in a workspace | Workspace-scoped |
| `wiki.recent` | Recent notes (by updated_at) | Workspace-scoped |
| `material.read` | Read an ingested material excerpt | Workspace-scoped |
| `directory.lookup` | Look up a user by email (admin only) | Tenant-scoped |
| `workspace.info` | Get workspace metadata and your membership tier | Workspace-scoped |
| `note.crossrefs` | Get cross-references (backlinks) for a note | Workspace-scoped |

All tools enforce RBAC — you only see content your membership tier permits.

---

## Token rotation

Rotate tokens every 90 days (or immediately if compromised):

1. Admin UI → Account → API Tokens → find token by label → **Revoke**
2. Create a new token (Step 1 above)
3. Update `claude_desktop_config.json` with the new token
4. Restart Claude Desktop

**Rate limit:** Maximum 10 tokens issued per 24-hour window per user. If you hit the limit, wait until the next UTC midnight reset.

---

## Token revocation if leaked

If a `wkt_` token is exposed (committed to git, pasted in a chat, etc.):

1. **Immediately:** Admin UI → Account → API Tokens → Revoke the leaked token
2. **Verify:** Attempt a call with the old token — expect 401
3. **Rotate:** Issue a new token and update all client configs
4. **Audit:** Admin UI → Audit Log — review recent calls made with the leaked token to assess exposure

The token prefix (`wkt_`) enables quick identification in logs and source diffs.

---

## Streamable HTTP vs SSE legacy

`wiki-team` v2.0 uses **Streamable HTTP** as the primary MCP transport (current spec). This is what Claude Desktop 0.10+ uses.

If you have an older MCP client that requires SSE transport, it will receive a `501 Not Implemented` response from the `/mcp` endpoint. SSE full transport is planned for v2.1. In the meantime, upgrade your MCP client.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `401 Unauthorized` | Token revoked or expired | Issue new token |
| `403 Forbidden` | Insufficient workspace tier | Ask workspace owner to promote your membership |
| `429 Too Many Requests` | Token issuance rate limit hit | Wait for UTC midnight reset |
| `501 Not Implemented` | Client using SSE transport | Upgrade MCP client to Streamable HTTP |
| Tool calls return no results | Workspace has no compiled notes | Upload a document + click Compile |
| `ECONNREFUSED` | MCP server not running | `bun run team:dev` or check server process |
