# Aura — Local Context Intelligence (LCI)
## Project Constitution for Claude Code

---

## Mission
Aura is a **local-first, privacy-preserving** consumer app that builds a living model of the user's context — timezone, language, lifestyle, and preferences — entirely on-device. No data leaves the machine without explicit user consent.

---

## Core Directives (Non-Negotiable)

### 1. Local-First Privacy
- **All processing happens on the local machine.** No telemetry, no cloud sync, no analytics unless the user explicitly opts in.
- Never write user data to any path outside the project `data/` directory.
- Never make outbound network calls from agent logic. All "notifications" go through the local mock gateway in `src/services/gateway.ts`.
- Log files must be stored locally in `data/logs/` and must never be transmitted.

### 2. TypeScript / Node.js Stack
- **Language**: TypeScript (strict mode, `"strict": true` in tsconfig).
- **Runtime**: Node.js LTS (≥ 20).
- **Module system**: ESM (`"type": "module"` in package.json).
- **Package manager**: npm. Lock file (`package-lock.json`) must be committed.
- No transpile-time magic — keep the build simple: `tsc` only.

### 3. Agent Squad Discipline
- Every agent lives in `.claude/agents/<name>.md` and has a **single, bounded responsibility**.
- Agents communicate only through shared state files in `data/` — never by calling each other directly.
- The General (Lead Agent) coordinates via `data/squad-state.json`.
- Agents must append a structured log entry to `data/logs/<agent>.log` after every action.

### 4. Commit Hygiene
- Target: **1,000 meaningful commits** toward the first milestone.
- Every commit message follows Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.
- Never commit secrets, API keys, or user PII — use `.env.local` (git-ignored).

### 5. File Watcher Safety
- File watchers (The Librarian) must use **non-recursive** watching by default.
- Watched paths are whitelisted in `config/watcher.json`. No path outside that list is observed.
- Symlinks are not followed.

---

## Directory Layout

```
aura/
├── CLAUDE.md              ← You are here
├── SOUL.md                ← The General's character & strategy
├── USER_IDENTITY.md       ← Living user identity document
│
├── src/
│   ├── index.ts           ← App entry point
│   ├── types/             ← Shared TypeScript interfaces
│   ├── agents/            ← Agent runner scaffolding
│   └── services/
│       └── gateway.ts     ← Local notification mock gateway
│
├── agents/                ← Agent working directories (scratch space)
│   ├── ethnographer/
│   ├── librarian/
│   └── secretary/
│
├── .claude/
│   └── agents/            ← Claude Code agent definitions
│       ├── ethnographer.md
│       ├── librarian.md
│       └── secretary.md
│
├── config/
│   ├── local.json         ← Runtime config (non-secret)
│   └── watcher.json       ← Whitelisted watch paths
│
└── data/                  ← All runtime state (git-ignored)
    ├── identity/
    ├── signals/
    ├── notifications/
    └── logs/
```

---

## What Claude Should Never Do
- Never delete files in `data/` without user confirmation.
- Never refactor agent boundaries without updating `SOUL.md`.
- Never add npm dependencies without noting the reason in the commit message.
- Never expose `data/` contents in logs that could be read by other processes.

---

## Glossary
| Term | Meaning |
|------|---------|
| LCI | Local Context Intelligence — the core product concept |
| Squad | The multi-agent team coordinated by The General |
| Signal | A raw data point captured from the local environment |
| Identity | The synthesized user model in `USER_IDENTITY.md` |
| Gateway | The local mock notification dispatch service |
