# LLM Wiki

An LLM-maintained personal knowledge base, built on [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). The LLM reads raw sources, compiles them into structured interlinked wiki pages, maintains an index, and keeps a hot cache for fast session startup. You browse the result in Obsidian.

The LLM is the librarian. You're the curator.

## How it works

You feed raw material (articles, papers, notes, transcripts) into a `raw/` folder. The LLM reads everything, writes structured wiki pages, creates cross-references, and maintains the index. You browse the results in Obsidian — following links, exploring the graph view, and asking questions.

## What you get

| Skill | What it does |
|---|---|
| `/wiki` | One-time setup wizard |
| `/wiki-ingest` | Drop raw sources in, AI builds your wiki |
| `/wiki-query` | Ask questions across everything you've fed it |
| `/wiki-lint` | Health-check the knowledge base |
| `/wiki-memory` | **(NEW v1.1)** Optional: auto-capture Claude Code sessions |

Plus a curated wiki schema with built-in protections against the regressions that real-world ingest experience tends to surface (see [CHANGELOG.md](CHANGELOG.md) for details).

## Optional Add-ons

### `/wiki-memory` (v1.1+)

Off by default. Auto-captures your Claude Code session transcripts as raw sources for later wiki ingest. Three hooks: SessionEnd (auto-save), PreCompact (anti-loss flush), SessionStart (context priming).

**Enable:**

    /wiki-memory enable
    /wiki-memory enable --scope project

**Toggle off:**

    /wiki-memory disable

**Manage:**

    /wiki-memory status     # check active hooks + capture count
    /wiki-memory flush      # manual flush current session
    /wiki-memory logs       # tail .memory.log

**⚠️ Privacy notice:**
Captured transcripts contain your full conversation, including any secrets, API keys, or sensitive content you've pasted. Review before committing the vault to a shared git repo. Recommend adding to your vault's `.gitignore`:

    echo "raw/sessions/" >> .gitignore
    echo "wiki/.state.json" >> .gitignore
    echo "wiki/.memory.log" >> .gitignore

**Capture-only mode (v1.1.0):** transcripts saved automatically; you run `/wiki-ingest` when ready. Auto-ingest mode planned for v1.2 with proper safeguards (recursion guard + cost ceiling).

## Prerequisites

- **[Obsidian](https://obsidian.md)** — markdown editor for browsing the wiki
- **An AI coding agent** — [Claude Code](https://claude.ai/code), [Codex](https://openai.com/codex), [Cursor](https://cursor.com), [Gemini CLI](https://github.com/google-gemini/gemini-cli), or any agent supporting [Agent Skills](https://agentskills.io)
- **[Node.js](https://nodejs.org)** — for the `npx skills` distribution CLI

## Install

    npx skills add Tedydev-web/llm-wiki-skills

The CLI prompts you for scope (global vs project-local) and which skills to install. Pick **global** + **all 5 skills** for the standard setup (or skip `wiki-memory` if you don't need session capture).

### Advanced — non-interactive one-liner

For multi-machine automation (skip all prompts, install all 5 skills globally):

    npx skills add Tedydev-web/llm-wiki-skills -g -y --all

Flags: `-g` = global scope, `-y` = skip confirmation prompts, `--all` = install all skills in the repo.

### Update / Uninstall

    npx skills update -g
    npx skills remove wiki wiki-ingest wiki-lint wiki-query wiki-memory -g -y

## Quick Start

1. **Install the skills** (above)
2. **Run the wizard:** `/wiki` in your AI agent — walks you through naming, location, domain, agent config, optional CLI tools
3. **Read `<vault>/docs/obsidian-setup.md`** — covers Obsidian config, hotkeys, Web Clipper setup, and the §6b aliases requirement
4. **Install [Obsidian Web Clipper](https://chromewebstore.google.com/detail/obsidian-web-clipper/cnjifjpddelmedmihgijeibhnjfabmlf)** — configure to save to `<vault>/raw/`
5. **Open vault in Obsidian** — "Open folder as vault", select your vault folder
6. **Clip your first article** to `raw/`, then run `/wiki-ingest`
7. **Browse** — follow `[[wikilinks]]`, explore the graph view, check `wiki/index.md` and `wiki/cache.md`
8. **Lint** — run `/wiki-lint` after every 10 ingests or monthly

## Vault structure

    your-vault/
    ├── .obsidian/
    │   └── app.json                 # pre-configured (newFileLocation: folder, attachments to raw/assets/)
    ├── docs/
    │   └── obsidian-setup.md        # READ THIS — Obsidian config + aliases requirement (§6b)
    ├── raw/                         # Inbox — drop sources here (immutable; LLM reads only)
    │   ├── assets/                  # Images and attachments
    │   └── sessions/                # NEW v1.1: auto-captured session transcripts (only if /wiki-memory enabled)
    ├── wiki/                        # LLM workspace
    │   ├── sources/                 # One summary per ingested source
    │   ├── entities/                # People, orgs, products, tools (with aliases:)
    │   ├── concepts/                # Ideas, frameworks, theories (with aliases:)
    │   ├── synthesis/               # Comparisons, analyses, themes
    │   ├── qa/                      # NEW v1.1: Q&A artifacts from /wiki-query --save
    │   ├── index.md                 # Master catalog
    │   ├── log.md                   # Append-only operation record
    │   ├── cache.md                 # Hot cache (~500 words, ingest+lint maintained)
    │   ├── .state.json              # NEW v1.1: incremental ingest tracking (sha256-keyed)
    │   └── .memory.log              # NEW v1.1: ops log (only if /wiki-memory enabled)
    ├── output/                      # Reports and generated artifacts
    └── CLAUDE.md                    # Agent config (varies — AGENTS.md / GEMINI.md / .cursor/rules/)

## Cross-project knowledge sharing

Use this wiki as a shared knowledge layer for OTHER Claude Code projects (the Karpathy 1-wiki-N-consumers pattern). Add a section to any project's `CLAUDE.md`:

    ## Knowledge Base

    For background context, facts, or domain knowledge, consult my LLM wiki:
    - Vault path: `/path/to/your/vault/`
    - Catalog: `/path/to/your/vault/wiki/index.md`
    - Hot cache: `/path/to/your/vault/wiki/cache.md` (read first for fast orientation)

    Search the vault before asking the user — most context is already documented.

The agent in that project will then ground its work against your wiki without you having to repeat context.

## Dev mode

For live editing of the skill source while keeping it active in your agent:

    git clone git@github.com:Tedydev-web/llm-wiki-skills.git ~/Documents/workspace/llm-wiki-skills
    cd ~/Documents/workspace/llm-wiki-skills
    npx skills add . -g -y --all

`npx skills` symlinks the local dir into agent paths — your edits show up immediately on next skill invocation.

## Optional CLI tools

The wizard offers to install these. All optional but recommended:

- **[summarize](https://github.com/steipete/summarize)** — summarize links, files, media from the CLI
- **[qmd](https://github.com/tobi/qmd)** — local search engine for markdown (useful as the wiki grows)
- **[agent-browser](https://github.com/vercel-labs/agent-browser)** — browser automation for web research

## Migration from v1.0.0 vaults

Backwards compatible — existing vaults work unchanged.

**Step-by-step walkthrough:**

    npx skills update -g           # pulls v1.1.0
    /wiki                          # idempotent — picks up missing dirs only
    /wiki-ingest                   # creates wiki/.state.json + sets _schema: 2
    /wiki-lint                     # 16-step audit (vs 13 before)
    # Optional: /wiki-memory enable

Notes: the first `/wiki-ingest` after update treats all existing files as new (one-time cost) to build the SHA256 state index. State tracking is cumulative from then on.

## FAQ

**Why is `aliases:` mandatory on entity/concept pages?**
Vanilla Obsidian resolves `[[Title Case]]` wikilinks by *filename basename*, not by H1. Without `aliases: [<H1 Title Case>]`, clicking a wikilink creates a stray `Title Case.md` file at vault root (because the kebab-case file isn't reachable). The ingest skill auto-applies aliases. Lint flags any missing.

**The wizard failed or I need to re-run setup.**
Run `/wiki` again — `onboarding.sh` is idempotent. It skips files that already exist instead of overwriting customizations.

**`wiki/index.md` or `wiki/cache.md` is out of sync.**
Run `/wiki-lint` — step 13 regenerates `cache.md` from `log.md` + frontmatter dates. Step 7 fixes index entries.

**Wikilinks are broken after renaming a page.**
Run `/wiki-lint` — step 1 scans for broken `[[wikilinks]]` and reports which files need updating.

**Can I use this with multiple AI agents?**
Yes. The wizard generates config files for each agent you select (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or `.cursor/rules/wiki.mdc`). All follow the same wiki schema.

**How often should I lint?**
After every 10 ingests or monthly — whichever comes first. Also before any major query/synthesis.

## Credits

- Conceptual foundation: the [LLM Wiki pattern by Andrej Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — public gist
- Distribution: [vercel-labs/skills](https://github.com/vercel-labs/skills) ecosystem CLI

## License

MIT © 2026 Tedydev-web — see [LICENSE](LICENSE).
