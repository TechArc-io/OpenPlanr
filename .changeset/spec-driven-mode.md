---
"openplanr": minor
---

Add spec-driven planning mode — third planning posture alongside agile + QT, designed for humans planning *for* AI coding agents.

A new `planr spec` command namespace authors specs that decompose into User Stories and Tasks with the **same artifact contract as the [openplanr-pipeline](https://github.com/openplanr/openplanr-pipeline) Claude Code plugin** — file Create/Modify/Preserve lists, Type=UI|Tech, agent assignment, DoD with build/test commands. The two products share one schema; no conversion adapter ever.

**Subcommands shipped:**

- `planr spec init` — Activate spec-driven mode in the current project
- `planr spec create [title]` — Create a self-contained `.planr/specs/SPEC-NNN-{slug}/` directory
- `planr spec list` — List all specs with status + decomposition counts
- `planr spec show <id>` — Print a spec + its US/Task tree
- `planr spec status [id]` — Decomposition state across one or all specs
- `planr spec destroy <id>` — `rm -rf` of a single self-contained spec directory
- `planr spec attach-design <id> --files <png>...` — Attach UI mockups for the pipeline's designer-agent
- `planr spec promote <id>` — Validate completeness, mark `ready-for-pipeline`, print the `/openplanr-pipeline:plan {slug}` handoff command

**Directory layout (per spec, self-contained):**

```
.planr/specs/SPEC-NNN-{slug}/
├── SPEC-NNN-{slug}.md         # the spec document
├── design/                    # PNG mockups + design-spec.md (written by pipeline's designer-agent)
├── stories/US-NNN-{slug}.md   # US-NNN scoped to this spec
└── tasks/T-NNN-{slug}.md      # T-NNN scoped to this spec
```

**Coexistence:** purely additive — agile (epic/feature/story/task) and QT modes work unchanged. Activate spec mode per project via `planr spec init`. Modes are independent; pick the posture that fits the work.

**Deferred to follow-up PR:** AI-driven `planr spec shape` (interactive 4-question SPEC authoring) and `planr spec decompose` (AI-generated US + Tasks). The schema, paths, and command surface are stable; this PR ships the scaffolding so authoring is usable today and AI can be added incrementally.

See `docs/proposals/spec-driven-mode.md` for the full design proposal and BL-011 for the original strategic feedback.
