---
"openplanr": minor
---

Add agent-friendly non-interactive mode and API key UX improvements

- Add `--yes`/`-y` flag for fully unattended planning workflows (Claude Code, Cursor, Codex)
- Auto-detect non-interactive terminals via TTY detection
- All prompts return sensible defaults when non-interactive
- Add `planr config remove-key` command to delete stored API keys
- Show clear multi-line guidance when API key is not configured
- Detect existing API keys (env var, OS keychain, encrypted file) during init
- Replace magic numbers with named CHECKLIST constants
- Fix TOCTOU race condition in checklist reads
