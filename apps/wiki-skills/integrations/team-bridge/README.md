# Team Bridge — Connect Personal Vault to Team Wiki Server

Opt-in add-on: lets a v1.2 personal-mode user also query their team-mode wiki
via an MCP token. Personal vault stays primary; team server is read-only.

## Prerequisites

- v1.2 personal mode installed (`npx skills add Tedydev-web/llm-wiki-skills`)
- Claude Desktop ≥ 0.10 (or Claude Code with MCP support)
- A `wkt_` token from your team admin

## Step 1 — Get a Token

Ask your team admin to issue a token: team admin UI → Settings → API Tokens →
Issue Token. The token starts with `wkt_`.

**Security:** Store it ONLY in `claude_desktop_config.json` or your shell
profile. NEVER paste it into a vault note or commit it to git. Rotate every
90 days. Revoke immediately if leaked.

## Step 2 — Configure Claude Desktop

Add the `wiki-team` entry to `mcpServers` in your Claude Desktop config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

See `example-claude-desktop.json` in this directory for a paste-ready snippet.
Restart Claude Desktop after saving.

## Step 3 — Verify

Ask Claude: "Search the team wiki for [topic]." Claude should invoke
`wiki.search` against the team server. If it only searches your personal vault,
confirm the config was saved and Claude Desktop was restarted.

## Revoking a Leaked Token

1. Team admin UI → Settings → API Tokens → Revoke
2. Remove token from `claude_desktop_config.json`
3. Restart Claude Desktop — then request a new token from your admin

## What Stays Private

The bridge is read-only from team into your local context. Your personal vault
notes are never sent to the team server.

## Extended Path (v2.1)

Auto-merge of personal + team results via a bash bridge (`team-fetch.ts`) is
planned for v2.1. Today, Claude Desktop `mcpServers` config is the path.
