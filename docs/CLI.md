# Planr CLI Reference

> Complete command reference for the `planr` CLI tool.
> Package: `openplanr` | Binary: `planr` (alias: `opr`)

---

## Installation

```bash
npm install -g openplanr

# Verify
planr --version
```

---

## Global Options

These options apply to **all** commands:

| Flag | Description | Default |
|------|-------------|---------|
| `--project-dir <path>` | Set project root directory | Current directory |
| `--verbose` | Enable verbose output | `false` |
| `--no-interactive` | Skip interactive prompts (use defaults) | `false` |
| `-V, --version` | Print version | — |
| `-h, --help` | Show help | — |

---

## Commands

### `planr init`

Initialize Planr in the current project.

```bash
planr init
planr init --name "my-project"
```

| Option | Description | Required |
|--------|-------------|----------|
| `--name <name>` | Project name | No (prompts) |

**What it creates:**

```
project-root/
├── planr.config.json          # Project configuration
└── docs/agile/
    ├── epics/
    ├── features/
    ├── stories/
    ├── tasks/
    ├── adrs/
    ├── checklists/
    │   └── agile-checklist.md  # Development checklist
    └── diagrams/
```

---

### `planr epic create`

Create a new epic.

```bash
planr epic create
planr epic create --title "User Authentication" --owner "Engineering"
```

| Option | Description | Required |
|--------|-------------|----------|
| `--title <title>` | Epic title | No (prompts) |
| `--owner <owner>` | Epic owner | No (prompts) |

**Interactive prompts:**

1. Epic title
2. Owner
3. Business value
4. Target users
5. Problem statement
6. Solution overview
7. Success criteria
8. Key features (comma-separated)
9. Dependencies (default: "None")
10. Risks (default: "None")

**Output:** `docs/agile/epics/EPIC-001-<slug>.md`

---

### `planr epic list`

List all epics.

```bash
planr epic list
```

**Example output:**

```
Epics
  EPIC-001  User Authentication
  EPIC-002  Payment Integration
```

---

### `planr feature create`

Create a feature from an epic.

```bash
planr feature create --epic EPIC-001
planr feature create --epic EPIC-001 --title "OAuth Login"
```

| Option | Description | Required |
|--------|-------------|----------|
| `--epic <epicId>` | Parent epic ID | **Yes** |
| `--title <title>` | Feature title | No (prompts) |

**Interactive prompts:**

1. Feature title
2. Owner
3. Overview
4. Functional requirements (comma-separated)
5. Dependencies (default: "None")
6. Technical considerations (default: "None")
7. Risks (default: "None")
8. Success metrics

**Output:** `docs/agile/features/FEAT-001-<slug>.md`

---

### `planr feature list`

List all features.

```bash
planr feature list
planr feature list --epic EPIC-001    # filter by epic
```

| Option | Description | Required |
|--------|-------------|----------|
| `--epic <epicId>` | Filter by epic ID | No |

---

### `planr story create`

Create a user story from a feature. Generates both a markdown file and a Gherkin acceptance criteria file.

```bash
planr story create --feature FEAT-001
planr story create --feature FEAT-001 --title "Login with Google"
```

| Option | Description | Required |
|--------|-------------|----------|
| `--feature <featureId>` | Parent feature ID | **Yes** |
| `--title <title>` | Story title | No (prompts) |

**Interactive prompts:**

1. Story title
2. As a (role)
3. I want to (goal)
4. So that (benefit)
5. Additional notes (optional)

**Output — two files:**

```
docs/agile/stories/
├── US-001-<slug>.md              # User story markdown
└── US-001-gherkin.feature        # Gherkin acceptance criteria
```

---

### `planr story list`

List all user stories.

```bash
planr story list
planr story list --feature FEAT-001    # filter by feature
```

| Option | Description | Required |
|--------|-------------|----------|
| `--feature <featureId>` | Filter by feature ID | No |

---

### `planr task create`

Create a task list from a user story.

```bash
planr task create --story US-001
planr task create --story US-001 --title "Implementation tasks"
```

| Option | Description | Required |
|--------|-------------|----------|
| `--story <storyId>` | Parent user story ID | **Yes** |
| `--title <title>` | Task list title | No (defaults to "Tasks for {storyId}") |

**Interactive prompts:**

1. Task list title
2. Task names (comma-separated, e.g.: "Setup, Implement API, Write tests")

Tasks are auto-numbered as `1.0`, `2.0`, `3.0`, etc.

**Output:** `docs/agile/tasks/TASK-001-<slug>.md`

---

### `planr task list`

List all task lists.

```bash
planr task list
planr task list --story US-001    # filter by story
```

| Option | Description | Required |
|--------|-------------|----------|
| `--story <storyId>` | Filter by story ID | No |

---

### `planr task implement`

Display a task list and guidance on implementing with AI agents.

```bash
planr task implement TASK-001
```

| Argument | Description | Required |
|----------|-------------|----------|
| `<taskId>` | Task list ID | **Yes** |

**Output:** Prints the full task list content and recommends using your AI assistant with generated rules.

---

### `planr checklist show`

Display the agile development checklist.

```bash
planr checklist show
```

Shows the full 5-phase checklist:
1. Requirements Analysis
2. Technical Design
3. Architecture Decision Records
4. Solution Planning
5. Solution Review

---

### `planr checklist reset`

Reset the checklist back to its initial state.

```bash
planr checklist reset
```

---

### `planr rules generate`

Generate AI agent rule files for Cursor, Claude Code, and/or Codex.

```bash
planr rules generate                  # all configured targets
planr rules generate --target cursor  # cursor only
planr rules generate --dry-run        # preview without writing
```

| Option | Description | Default |
|--------|-------------|---------|
| `--target <target>` | `cursor`, `claude`, `codex`, or `all` | `all` |
| `--dry-run` | Show what would be generated | `false` |

**Generated files by target:**

| Target | Output |
|--------|--------|
| Cursor | `.cursor/rules/200x-*.mdc` (6 rule files) |
| Claude | `CLAUDE.md` |
| Codex | `AGENTS.md` |

---

### `planr status`

Show project planning progress at a glance.

```bash
planr status
```

**Example output:**

```
Planr Status — my-project

  ● Epics: 2
    EPIC-001  User Authentication
    EPIC-002  Payment Integration
  ● Features: 3
    FEAT-001  OAuth Login
    FEAT-002  Email/Password Auth
    FEAT-003  Stripe Checkout
  ● User Stories: 5
    US-001  Login with Google
    US-002  Login with GitHub
    ... and 3 more
  ○ Task Lists: 0

Targets: cursor, claude, codex
Artifacts: docs/agile/
```

`●` = has items | `○` = empty

---

## Workflow

The typical agile planning flow follows this hierarchy:

```
planr init
  └─ planr epic create
       └─ planr feature create --epic EPIC-001
            └─ planr story create --feature FEAT-001
                 └─ planr task create --story US-001
                      └─ planr task implement TASK-001

planr rules generate    ← generates AI rules from your artifacts
planr status            ← see progress overview
```

---

## ID Convention

| Artifact | Prefix | Example |
|----------|--------|---------|
| Epic | `EPIC` | EPIC-001 |
| Feature | `FEAT` | FEAT-001 |
| User Story | `US` | US-001 |
| Task List | `TASK` | TASK-001 |

---

## Config File

`planr.config.json` stores project settings:

```json
{
  "projectName": "my-project",
  "targets": ["cursor", "claude", "codex"],
  "outputPaths": {
    "agile": "docs/agile",
    "cursorRules": ".cursor/rules",
    "claudeConfig": ".",
    "codexConfig": "."
  },
  "idPrefix": {
    "epic": "EPIC",
    "feature": "FEAT",
    "story": "US",
    "task": "TASK"
  },
  "createdAt": "2026-03-26"
}
```
