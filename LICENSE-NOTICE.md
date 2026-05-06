# LICENSE-NOTICE

[PLACEHOLDER — finalized in P12]

This file will be completed during Phase 12 (release preparation).
Structure is fixed below; content sections marked `[TODO-P12]` are pending.

---

## apps/wiki-skills (personal mode)

License: **MIT**
Copyright: Tedydev-web contributors
Full license text: `apps/wiki-skills/LICENSE` (or repo root `LICENSE`)

This component predates any reading of third-party source code and is an
independent clean-room implementation (see ADR 001).

---

## apps/wiki-team + packages/wiki-* (team mode)

License: **PolyForm Noncommercial 1.0.0**
Full license text: https://polyformproject.org/licenses/noncommercial/1.0.0/

**Attribution (required by PolyForm-NC §4):**

> Originally derived from `nduckmink/arkon` under PolyForm Noncommercial 1.0.0.
> Translated to TypeScript and extended by Tedydev-web.

This code is a derivative work. It may not be used to provide a commercial
service without a separate license from the upstream author. Non-commercial
self-hosted use is permitted under PolyForm-NC 1.0.0.

**MuPDF.js note:** The `mupdf` npm package (AGPL-3.0) is embedded in the
BullMQ ingest worker. Binary distribution of `apps/wiki-team` is therefore
AGPL-bound. Source code is available at this repository's public URL.
[TODO-P12: insert canonical repo URL]

---

## Third-party dependencies

[TODO-P12: auto-generate from `bun run licenses` output and append here]

---

*This notice was created in P00 as a structural placeholder.
P12 finalizes all `[TODO-P12]` sections before the v2.0.0 release tag.*
