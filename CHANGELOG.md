# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-26

### Added

- **CLI tool** with `planr` command (alias: `opr`)
- **`planr init`** — initialize project with config and agile directory structure
- **`planr epic create/list`** — create and list epics
- **`planr feature create/list`** — create features from epics
- **`planr story create/list`** — create user stories with Gherkin acceptance criteria
- **`planr task create/list/implement`** — create task lists from stories
- **`planr checklist show/reset`** — agile development checklist
- **`planr rules generate`** — generate AI agent rule files
  - Cursor (`.cursor/rules/*.mdc`)
  - Claude Code (`CLAUDE.md`)
  - Codex (`AGENTS.md`)
- **`planr status`** — project planning progress overview
- Handlebars template system for all artifact generation
- Zod schema validation for configuration
- Auto-incrementing ID system (EPIC-001, FEAT-001, US-001, TASK-001)
- Full agile hierarchy enforcement (epic > feature > story > task)
