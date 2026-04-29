---
"openplanr": minor
---

Multi-runtime rules: extend `planr rules generate` with a `--scope` flag for cross-runtime pipeline support.

`planr rules generate` now accepts `--scope <agile|pipeline|all>` (default: `agile` — preserves existing behaviour byte-for-byte). The new `pipeline` scope generates rule files that drive the openplanr-pipeline two-phase spec-driven flow on the chosen runtime, giving Cursor and Codex first-class parity with the Claude Code plugin.

**Cursor (`--target cursor --scope pipeline`):**
- `.cursor/rules/openplanr-pipeline.mdc` — master rule (mode detection, R1 human gate, runtime parity notes)
- `.cursor/rules/openplanr-pipeline-plan.mdc` — PO Phase orchestration (Composer subagent dispatch)
- `.cursor/rules/openplanr-pipeline-ship.mdc` — DEV Phase orchestration (parallel subagents, qa gate, snapshot, marker)
- `.cursor/rules/agents/{db,designer,specification,frontend,backend,qa,devops,doc-gen}-agent.md` — 8 role bodies vendored verbatim from `openplanr-pipeline/agents/` (frontmatter stripped; Cursor uses different permission model)

**Codex (`--target codex --scope pipeline`):**
- `AGENTS.md` extended with a `## OpenPlanr Pipeline Orchestration` section. Roles modelled as personas (Codex doesn't have separate subagent processes); R1, R2, R5, R6, R8, R9 declared at prompt level with conformance-test enforcement.

**Claude (`--target claude --scope pipeline`):**
- `CLAUDE.md` gets a conditional `## OpenPlanr Pipeline (Path A)` block under `{{#if pipelineScope}}`
- Sibling `openplanr-pipeline.md` reference card with install commands, slash command list, and cross-runtime pointer

`--scope all` produces both agile and pipeline rules side-by-side.

**Compatibility matrix and OpenPlanr Protocol v1.0.0** documented in `openplanr-pipeline/docs/protocol/` and `openplanr-pipeline/docs/compatibility-matrix.md` (pipeline plugin v0.6.0+).

**Migration:** none. Default `--scope agile` keeps the existing 6 Cursor `.mdc` files, single CLAUDE.md, single AGENTS.md outputs unchanged.
