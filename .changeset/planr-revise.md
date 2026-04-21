---
"openplanr": patch
---

Add `planr revise` — agent-driven alignment of planning artifacts with codebase reality

New command complementing `planr refine` (prose polish) with a focus on *factual* alignment:

- `planr revise <ID>` — revise a single artifact (epic / feature / story / task)
- `planr revise <ID> --cascade` — top-down revision of an artifact and its descendants (epic → features → stories → tasks); children see the *revised* parent in their context
- `planr revise --all` — revise every epic in the project, with a content-hash cache that skips unchanged artifacts
- `--dry-run`, `--yes`, `--allow-dirty`, `--scope-to prose|references|paths|all`, `--no-code-context`, `--no-sibling-context`, `--audit-format md|json`, `--max-writes-per-run`

Four-layer safety pipeline (every run):

1. **Clean-tree gate** — refuses to run on a dirty git working tree (override with `--allow-dirty`)
2. **Evidence verification** — every AI citation uses a typed kind (`file_exists`, `file_absent`, `grep_match`, `sibling_artifact`, `source_quote`, `pattern_rule`); unverifiable citations are dropped. When a majority of evidence fails to verify, the decision is demoted from `revise` to `flag` so a human reviews instead of silently applying
3. **Diff preview + confirmation** — per-artifact menu: `[a]pply / [s]kip / [e]dit rationale / [d]iff again / [q]uit`; `--yes` still requires typed "YES" at start in an interactive TTY, skipped in non-TTY (CI) environments
4. **Post-flight graph-integrity check + git rollback** — after writes, `syncParentChildLinks` runs; if any cross-reference broke, affected artifact paths are restored via `git checkout`. This is the only v1 mechanism allowed to use the word "rollback"; atomic writes are called atomicity

Template-conformance guardrail:

- Revise is taught the canonical `## Section` set for each artifact type (from the Handlebars templates) and instructed to flag rather than add sections outside it. Prevents task-level conventions like `## Relevant Files` from leaking into epics
- Existing user-maintained custom sections are preserved byte-for-byte

Other safety properties:

- **Atomic writes** with sidecar backups (`.planr/reports/revise-<scope>-<date>/backup/`) — no partial files ever on disk
- **Facts win from code, plan wins on intent** — concrete paths and symbols are rewritten to match the repo; what the feature is *supposed to do* is never rewritten (intent conflicts surface as `flag` with ambiguous entries)
- **Graceful mid-cascade interrupt** — Ctrl+C and `[q]uit` let any in-flight atomic write complete, stop cleanly, and flush the audit log immediately; already-applied artifacts stay applied
- **SIGINT closes the audit log cleanly** with an `interrupted: sigint` footer, so Ctrl+C at the confirmation prompt doesn't leave a half-written log

Every run emits a Markdown or JSON audit log under `.planr/reports/` capturing applied / skipped / flagged / failed artifacts with rationale, evidence, ambiguities, and unified diffs — dry-run included.

After a successful apply, revise prints:

```
git commit -am "chore(plan): revise <SCOPE> against codebase"
```

See the [README section on `planr revise`](https://github.com/openplanr/OpenPlanr/blob/main/README.md#planr-revise--align-planning-with-reality) for workflow examples.
