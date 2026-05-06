# Obsidian Setup Checklist — {{VAULT_NAME}}

Configure Obsidian for your `{{VAULT_NAME}}` vault following the [LLM Wiki](https://github.com/Tedydev-web/llm-wiki-skills) pattern.

> Goal: LLM owns `wiki/`, user clips sources into `raw/`, neither steps on the other.

## 1. Settings → Files and links

| Setting | Value | Reason |
|---|---|---|
| Default location for new notes | **In the folder specified below** | No stray files at vault root |
| Folder to create new notes in | `wiki/synthesis` | Exploratory zone — LLM organizes via `/wiki-lint` |
| Default location for new attachments | **In the folder specified below** | |
| Attachment folder path | `raw/assets/` | LLM Wiki standard |
| New link format | `Relative path to file` | OK |
| Use `[[Wikilinks]]` | ✅ ON | Required by skill |
| Automatically update internal links | ✅ ON | Rename doesn't break links |

> Already pre-configured in `.obsidian/app.json` by the wizard — no manual setup needed. This file is a reference for new vault setups.

## 2. Settings → Hotkeys

Bind these hotkeys (search in Settings → Hotkeys):

| Action | Suggested hotkey | Use case |
|---|---|---|
| `Download attachments for current file` | `Cmd+Shift+D` (Mac) | After clipping article with images, press to download into `raw/assets/` |
| `Open graph view` | `Cmd+G` | Visualize wiki connections |
| `Quick switcher: Open quick switcher` | `Cmd+O` (default) | Jump to any page fast |

## 3. Browser Extension

**Obsidian Web Clipper** (Chrome/Edge/Firefox):

- URL: https://chromewebstore.google.com/detail/obsidian-web-clipper/cnjifjpddelmedmihgijeibhnjfabmlf
- Configure clip output → `raw/` folder of `{{VAULT_NAME}}` vault
- Format: Markdown
- Each article = 1 `.md` file

## 4. Recommended Community Plugins

Enable in Settings → Community plugins → Browse:

| Plugin | Required? | Use case |
|---|---|---|
| **Dataview** | 🟡 Optional | Query YAML frontmatter (tags/sources/dates) → dynamic tables |
| **Marp** (slides) | 🟡 Optional | Generate slide deck from wiki page |
| **Templater** | 🟡 Optional | Templates if you write notes manually outside `/wiki-ingest` |

Built-in (already available):
- ✅ Graph view
- ✅ Backlinks pane
- ✅ Outline pane
- ✅ Local graph (right sidebar)

## 5. Daily Workflow

```
1. Clip article ──→ raw/<title>.md          (Web Clipper)
2. Cmd+Shift+D    ──→ raw/assets/*.png      (download images)
3. /wiki-ingest                      (LLM processes → wiki/)
4. Browse wiki/ in Obsidian                  (graph view, backlinks)
5. /wiki-query "question"            (synthesis can save to wiki/synthesis/)
6. Every 10 ingests: /wiki-lint      (health check)
```

## 6. Common Pitfalls

| ❌ Wrong | ✅ Right |
|---|---|
| Click non-existent wikilink → stray file at root | Pre-configured: `newFileLocation: folder` → drops to `wiki/synthesis/` |
| Click `[[Title Case]]` → Obsidian creates new file at root because no kebab-case match | Fixed: `aliases: [Title Case]` in entity/concept frontmatter |
| Edit files in `raw/` | `raw/` is immutable — LLM-only read; user doesn't edit |
| Manually create note in `wiki/sources/` | Let `/wiki-ingest` create |
| Forget to update `wiki/log.md` after ingest | Skill auto-appends if you run `/wiki-ingest` correctly |

## 6b. Wikilink resolution — why `aliases:` is required

LLM Wiki naming convention:
- Filename: `kebab-case.md` (e.g. `huu-giang.md`)
- Wikilink: `[[Title Case]]` (e.g. `[[Hữu Giang]]`)

**Vanilla Obsidian doesn't bridge these two formats** — clicking `[[Hữu Giang]]` creates `Hữu Giang.md` at root (violates `newFileLocation` which only applies when file doesn't exist).

**Fix:** Add `aliases:` to frontmatter:

    ---
    tags: [author, devops]
    aliases: [Hữu Giang]
    sources: [...]
    ---

`aliases[0]` MUST match the H1 exactly. Skill `/wiki-ingest` auto-applies this when creating entity/concept pages — `/wiki-lint` step 9 enforces it.

## 7. New Vault Setup Reminders

```bash
# 1. Install skills (interactive — pick global + all 4 skills)
npx skills add Tedydev-web/llm-wiki-skills
# Or non-interactive one-liner: npx skills add Tedydev-web/llm-wiki-skills -g -y --all

# 2. Run wizard
/wiki   # in any AI agent (Claude Code, Codex, Cursor, Gemini CLI)

# 3. Open vault in Obsidian: "Open folder as vault"

# 4. Apply this checklist
```

## Related

- `wiki/index.md` — master catalog
- `wiki/log.md` — operation history
- `wiki/cache.md` — hot cache (recent activity, ~500 words; auto-updated by ingest + lint)
- Agent configs at vault root — `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, or `.cursor/rules/wiki.mdc`
