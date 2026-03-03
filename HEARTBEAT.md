# HEARTBEAT.md — Aura Squad Mission Log

> The General's running record of operations, objectives, and squad velocity.
> Updated after every significant milestone.

---

## Current Pulse

| Field | Value |
|-------|-------|
| **Session** | Operation Watchtower (ongoing) |
| **Commit count** | 27 / 1,000 |
| **Squad status** | 5 agents running — Librarian, Secretary, Chronicler, Strategist, Ethnographer |
| **Identity freshness** | Updated this session |
| **Last dispatch** | Gilded Toast — Chronicler drafts on every git commit |
| **Next objective** | Mission 8: Deep Context Extraction |

---

## ✅ Completed Operations

### Operation Watchtower — Commit 1
**Status**: Complete
**Objective**: Bootstrap the full multi-agent pipeline end-to-end.

Deliverables:
- `src/types/index.ts` — all shared TypeScript interfaces
- `src/services/gateway.ts` — local mock notification gateway
- `src/services/watcher.ts` — chokidar wrapper (non-recursive, no symlinks, awaitWriteFinish)
- `src/agents/librarian.ts` — Downloads watcher → `data/signals/new_file.json`
- `src/agents/ethnographer.ts` — Vibe Check engine → `USER_IDENTITY.md` + `enriched_signal.json`
- `src/agents/secretary.ts` — Midnight Scholar greeting → `data/notifications/queue.json`
- First end-to-end notification generated: `test_signal.pdf`
- Tone: Academic/Professional · Confidence: 100%

---

### Operation Voice — Commit 2
**Status**: Complete
**Objective**: Live Windows notification delivery on every new acquisition.

Deliverables:
- `src/services/dispatcher.ts` — PowerShell dispatch chain (BurntToast → balloon fallback)
- Secretary integrated: calls `drainQueue()` immediately after every `enqueueNotification()`
- Dead-letter queue for exhausted retries
- Atomic queue writes (tmp → rename)
- Verified: balloon tip on screen for `api_spec.json`

---

### Operation Gilded Voice — Commit 3
**Status**: Complete
**Objective**: Upgrade to high-fidelity BurntToast notifications — branded logo, scholarly chime.

Deliverables:
- BurntToast 1.1.0 installed (NuGet provider auto-updated)
- `assets/aura-logo.png` — 128×128 branded icon (midnight bg #0f0c23, gold 'A' #d4af37)
- Dispatcher upgraded: `-AppLogo`, `-Sound 'Reminder'`, `-Attribution 'Local Context Intelligence'`
- 3-line `-Text` array: `Aura` / subject / body
- Verified: rich BurntToast on screen for `Aura_Gilded_Test.pdf`
- Repository mirrored to GitHub: `https://github.com/shairumi/aura_lci` (public)

---

### Midnight Scholar Checklist — Commit 4
**Status**: Complete
**Objective**: Documentation, heartbeat sync, cloud mirror update.

Deliverables:
- `README.md` — comprehensive multi-agent architecture + LCI philosophy
- `HEARTBEAT.md` — this file, mission log seeded and live
- Sentinel handover confirmed: squad watching, queue empty and ready

---

### Mission 5: The Dev Chronicle
**Status**: Complete
**Objective**: Every git commit automatically generates build-in-public content drafts.

Deliverables:
- **GitWatcher** (Librarian): watches `.git/COMMIT_EDITMSG`, runs `git log`/`git show`, writes `data/signals/git-commit-signal.json`
- **The Chronicler** (`src/agents/chronicler.ts`): watches `git-commit-signal.json`, generates Twitter/LinkedIn/Substack drafts from conventional commit + diff stats, writes to `agents/secretary/drafts/<shortHash>/`
- **Gilded Toast** (Secretary): watches `drafts-ready.json`, fires BurntToast: *"The Chronicler has prepared your drafts for Commit X"*
- New types: `GitCommitSignal`, `DiffStats`, `DraftsReadySignal`
- New scripts: `npm run chronicler`, `npm run mine-history`

---

### Mission 6: The Strategist
**Status**: Complete
**Objective**: Apply PM + local-first constraint lens to every commit, producing strategy vault docs.

Deliverables:
- **The Strategist** (`src/agents/strategist.ts`): reads `git-commit-signal.json`, scores against 8 local-first themes, generates `deep-dive.md`, `pm-tutorial.md`, `decision-log.md` in `agents/secretary/strategy-vault/<shortHash>/`
- `localFirstScore` (0–10) and `pmInsight` in `StrategyVaultSignal`
- New scripts: `npm run strategist`, `npm run mine-strategy`

---

### Mission 7: Auto-Start System
**Status**: Complete
**Objective**: Agents start automatically at login and self-heal if they crash.

Deliverables:
- `scripts/health-check.ps1` — detects dead agents via `Get-CimInstance Win32_Process`; restarts them; supports `-Scope daemon` and `-Scope full`
- `scripts/register-scheduler.ps1` — registers Windows Task Scheduler tasks (`Aura\DaemonAtLogin`, `Aura\DaemonHealthCheck` every 30 min) and installs pre-commit hook
- `scripts/hooks/pre-commit` — tracked bash script; calls `health-check.ps1 -Scope full` before every `git commit`
- `scripts/start_squad.ps1` updated — starts Chronicler + Strategist, auto-restarts crashed long-running agents

---

## 🔜 Active Objective — Mission 8

### Mission 8: Deep Context Extraction
**Status**: Queued
**Priority**: High
**Assigned to**: The Ethnographer (primary) + The Librarian (signal source)

**Objective**: Parse PDF content for identity enrichment — improving confidence scores beyond filename tokenisation.

**Proposed approach**:
1. Local PDF parser (`pdf-parse` or `pdfjs-dist`) — no external calls
2. Librarian sets `requiresExtraction: true` for `.pdf` signals
3. Ethnographer gains `extractPdfContext()` — reads first 3 pages, maps noun phrases to extended lexicon
4. `USER_IDENTITY.md` `vocabularyDomain` and `recentFocusAreas` updated with extracted themes

**Privacy constraint**: raw text never written to disk — only derived keyword tokens.

---

## 📋 Backlog (Unscheduled)

| Mission | Description | Priority |
|---------|-------------|----------|
| Mission 9 | Desktop watcher — extend Librarian to `~/Desktop` | Medium |
| Mission 10 | Identity snapshot export — periodic `data/identity/snapshot_<date>.json` | Medium |
| Mission 11 | Structured vibe history — rolling 30-day tone pattern in `USER_IDENTITY.md` | Low |
| Mission 12 | BurntToast action buttons — "Index this" / "Ignore" user response capture | Medium |
| Mission 13 | First milestone review at commit 100 — identity accuracy self-assessment | High |

---

## Squad Velocity

```
Commit  1  ██  Bootstrap (Operation Watchtower)
Commit  2  ██  Dispatcher (Operation Voice)
Commit  3  ██  BurntToast (Operation Gilded Voice)
Commit  4  ██  Docs + heartbeat
Commits 5–12   ██████████  Mission 5: The Dev Chronicle
Commits 13–18  ████████    Mission 6: The Strategist
Commits 19–24  ████████    Mission 7: Auto-Start System
Commits 25–26  ███         Docs sync
...
Commit 1000 (target)
```

*Velocity target: 10+ commits per active session.*

---

*"The model is never finished. It is only more or less accurate."* — The General
