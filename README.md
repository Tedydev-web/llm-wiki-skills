# Tedydev-web LLM Wiki

Two products in one repo, sharing a brand:

| You want... | Use this | Install |
|---|---|---|
| Personal Obsidian-based knowledge base (v1.2, MIT) | `apps/wiki-skills/` | `npx skills add Tedydev-web/llm-wiki-skills` |
| Multi-user team wiki with RBAC + MCP (v2.0, PolyForm-NC) | `apps/wiki-team/` | See [apps/wiki-team/README.md](apps/wiki-team/README.md) |

---

## Personal mode — `apps/wiki-skills/` (v1.2)

An LLM-maintained personal knowledge base built on the [Karpathy LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). The LLM reads your raw sources, compiles structured interlinked wiki pages, and keeps a hot cache. You browse results in Obsidian.

**5 slash-command skills:**

| Skill | What it does |
|---|---|
| `/wiki` | One-time setup wizard |
| `/wiki-ingest` | Drop raw sources in, AI builds your wiki |
| `/wiki-query` | Ask questions across everything you've fed it |
| `/wiki-lint` | Health-check the knowledge base |
| `/wiki-memory` | Auto-capture Claude Code sessions (v1.1+) |

**Install (personal mode):**

```sh
npx skills add Tedydev-web/llm-wiki-skills
```

The CLI prompts for scope (global vs project) and which skills to install. For non-interactive one-liner:

```sh
npx skills add Tedydev-web/llm-wiki-skills -g -y --all
```

**Prerequisites:** [Obsidian](https://obsidian.md), [Node.js](https://nodejs.org), an AI coding agent (Claude Code, Cursor, Codex, Gemini CLI).

Full documentation: [`apps/wiki-skills/`](apps/wiki-skills/) — see skills README files in `skills/*/SKILL.md`.

---

## Team mode — `apps/wiki-team/` (v2.0)

A self-hosted multi-user team wiki server with:

- **RBAC dual-realm** — 4-tier workspace membership + global permission strings
- **Wiki-compile worker** — BullMQ agent loop that ingests PDFs, DOCX, URLs into structured notes
- **MCP exposure** — 8 tools accessible from Claude Desktop via Bearer token
- **REST API** — 25 Hono endpoints with Swagger UI + OpenAPI spec
- **Admin frontend** — Next.js 15 workspace/member/token management UI
- **Self-hosted** — Docker Compose with Postgres 16 + pgvector + Redis + MinIO

**Quickstart:**

```sh
# 1. Clone and install
git clone https://github.com/Tedydev-web/llm-wiki-skills
cd llm-wiki-skills
bun install

# 2. Start infrastructure
docker compose up -d

# 3. Run migrations
bun run db:migrate

# 4. Start team server + admin UI
bun run team:dev
bun run --cwd apps/wiki-team/frontend-admin dev
```

Full guide: [apps/wiki-team/README.md](apps/wiki-team/README.md)

---

## License

| Component | License |
|---|---|
| `apps/wiki-skills/` (personal mode, v1.2) | MIT |
| `apps/wiki-team/` + `packages/wiki-{schema,mcp,shared}/` (team mode, v2.0) | PolyForm Noncommercial 1.0.0 |
| `packages/wiki-pdf-extract/` (MuPDF.js boundary) | AGPL-3.0-only |

PolyForm-NC prohibits SaaS resale. Non-commercial self-hosted use is permitted.
Full dual-license explanation: [LICENSE-NOTICE.md](LICENSE-NOTICE.md)

---

## Contributing

- Personal mode (`apps/wiki-skills/`): PR welcome; MIT CLA applies.
- Team mode (`apps/wiki-team/`): PR welcome; PolyForm-NC applies to contributions.
- Anti-trace gate runs on every PR (see [ADR 001](docs/decisions/001-clean-room-implementation.md) + [ADR 009](docs/decisions/009-arkon-derivative-status.md)).
- Do not commit `.env` files, OAuth credentials, or real API keys.

## Dev mode (live editing)

```sh
git clone git@github.com:Tedydev-web/llm-wiki-skills.git ~/Documents/workspace/llm-wiki-skills
cd ~/Documents/workspace/llm-wiki-skills
npx skills add . -g -y --all   # personal skills symlinked immediately
bun install                     # team mode workspace
```

## Credits

- Personal mode: [LLM Wiki pattern by Andrej Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
- Distribution: [vercel-labs/skills](https://github.com/vercel-labs/skills) ecosystem CLI
- Team mode: derivative of `nduckmink/arkon` under PolyForm Noncommercial 1.0.0 (see [ADR 009](docs/decisions/009-arkon-derivative-status.md))
