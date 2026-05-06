# Team Bridge Reference

How to connect your personal v1.2 wiki vault to a team-mode wiki server.

## How It Works

Personal vault stays primary. The team server is an optional read-only source
wired in via Claude Desktop's `mcpServers` config — no modifications to your
v1.2 skill files required.

## Getting a Token

Ask your team admin to issue you an API token from the team admin UI
(Settings → API Tokens). The token will start with `wkt_`.

Store it ONLY in `claude_desktop_config.json` — never in a vault note or git.

## Env Vars

| Variable | Purpose |
|---|---|
| `WIKI_TEAM_REMOTE_URL` | Full URL of team wiki server, e.g. `https://wiki.example.com` |
| `WIKI_TEAM_REMOTE_TOKEN` | Bearer token starting with `wkt_` |

These are intentionally prefixed `WIKI_TEAM_REMOTE_*` to avoid collisions with
team-server-side env vars if both happen to run in the same shell.

## Commands Available After Setup

Once the `wiki-team` MCP server entry is added to Claude Desktop and the
token env vars are set, Claude can call:

- `wiki.search` — full-text + semantic search across team workspaces you have
  read access to
- `wiki.fetch` — retrieve a single note by slug from the team server

Your personal vault tools (`wiki-query`, `wiki-ingest`, etc.) are unaffected.

## Revoking a Leaked Token

1. Team admin UI → Settings → API Tokens → Revoke
2. Remove token from `claude_desktop_config.json`
3. Restart Claude Desktop
4. Request a new token

## Setup Guide

See `apps/wiki-skills/integrations/team-bridge/README.md` for step-by-step
configuration instructions and a paste-ready `claude_desktop_config.json`
snippet.

## v2.1 Roadmap

Automatic personal+team result merging via a bash bridge (`team-fetch.ts`) is
planned for v2.1. The current v2.0 path requires manual Claude Desktop config.
