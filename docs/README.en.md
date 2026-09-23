# Documentation hub

> Navigation companion to the canonical Chinese standards.

Status: current. Updated: 2026-09-23.

Start with [the documentation map](README.md). It maps every `app/<service>` directory to its `docs/services/<service>/README.md` and to the governing convention. Conventions, service contracts, architecture, design, operations and decisions are all centralized under docs. Historical documents are explicitly labelled and never override current rules. Use the root AGENTS entry for agent task routing.

Branch model: only `main` (production) and `stage` (preview) are long-lived; task branches are created from `stage` and must be deleted right after merge. Confirm your branch before any write. See [BRANCHING.md](conventions/BRANCHING.md). Releases are cut from tags only (`vX.Y.Z-rc.N` → preview, `vX.Y.Z` → production); see [RELEASES.md](conventions/RELEASES.md).
