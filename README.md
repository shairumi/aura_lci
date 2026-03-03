# Aura — Local Context Intelligence

**Your git commits become LinkedIn posts, Twitter threads, and Substack entries —
in seconds, entirely on your machine.**

Aura is a local-first multi-agent system. It watches your filesystem and git
history, builds a living model of your context, and generates structured outputs
from local signals. No cloud. No API keys. No data leaves your device.

[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/built%20with-TypeScript-blue)](#)
[![Platform](https://img.shields.io/badge/platform-Windows-lightgrey)](#)

---

## What You Get

- **Every git commit → 4 ready-to-post drafts** — Twitter thread, LinkedIn post,
  Substack diary entry, Medium article — written to local files the moment you push
- **A living context model** built from your timezone, language, activity patterns,
  and file signals — updated continuously, never transmitted
- **Windows toast notifications** when drafts are ready or a new signal arrives —
  calibrated to one tone: concise, analytical, occasionally irreverent
- **Pluggable domain agents** — point the same architecture at any domain. Legal,
  medical, research, real estate. The Financial Advisor is the reference
  implementation. The pattern is yours to extend.

---

## 30-Second Demo

<!-- GIF: commit fires → Gilded Toast appears → four drafts in agents/secretary/drafts/<hash>/ -->

---

## Install

**Prerequisites:** Node.js ≥ 20, Windows 10/11

```bash
git clone https://github.com/shairumi/aura_lci.git
cd aura_lci
npm install && npm run build
```

**Optional — richer toast notifications:**
```powershell
Install-Module -Name BurntToast -Force -Scope CurrentUser
```

**Start the agents you need:**
```bash
npm run librarian      # watches git commits + ~/Downloads
npm run chronicler     # git commit → drafts
npm run secretary      # notification dispatch
```

After your next commit, open `agents/secretary/drafts/<shortHash>/`.
Your four drafts are there.

---

## What It Does

### Dev Chronicle

Aura watches `.git/COMMIT_EDITMSG`. Every commit triggers four draft documents
written to `agents/secretary/drafts/<shortHash>/`:

| File | Format | Structure |
|------|--------|-----------|
| `twitter.txt` | Thread | Hook + 3 numbered points + CTA + hashtags |
| `linkedin.txt` | Post | Professional reflection + PM insight hook |
| `substack.md` | Diary entry | Diary → Insight → Request |
| `medium.md` | Article | Problem → Solution → Data (GEO-optimized) |

A Windows toast fires when the drafts are ready. Run
`npm run chronicler -- --mine-history` to generate drafts for your full commit
history.

---

### Context Intelligence

The Ethnographer performs a one-shot scan of your local system — timezone, locale,
keyboard layout, language settings, file activity patterns — and writes a structured
identity document to `USER_IDENTITY.md`. It updates every time a new signal arrives.

No file contents are ever read. Nothing is transmitted. The identity model lives in
a plain Markdown file you own, can edit, and can delete.

**What it tracks:** linguistic profile · geographic context · active hours ·
life stage signals · cultural preferences · current focus

---

### Domain Intelligence *(pluggable)*

The Financial Advisor is the reference implementation of a domain agent: it watches
`~/Downloads` for files matching a financial document pattern, scores them by
relevance, reads your financial context from `USER_IDENTITY.md`, and generates a
structured action plan — saved locally, never transmitted.

**The architecture is not specific to finance.** Any domain that produces local
files can be served by the same four-step pattern:

1. **Detect** — classify the incoming file (filename matching, content scan, or manual)
2. **Score** — assess relevance and extract domain context
3. **Generate** — produce a structured output using identity context
4. **Signal** — notify The Secretary to dispatch a toast

Fork `src/agents/financial-advisor.ts` and `src/utils/financial-detection.ts`
as your starting point.

---

## Why Local?

Most AI personalization systems require data centralization as a prerequisite. Aura
explores a different constraint: what can a system learn about you using only
on-device signals, with zero data egress?

The answer, across timezone detection, file activity, git history, and document
patterns, is: more than most people expect.

**No network calls exist in any agent. Read the source.**

---

## Privacy Guarantees

| What Aura does | What Aura never does |
|----------------|----------------------|
| Reads filenames and metadata (size, mtime) | Read file contents |
| Writes all state to local `data/` | Transmit data to any external server |
| Fires notifications via local PowerShell | Call external APIs or webhooks |
| Logs activity to `data/logs/` | Share logs with other processes |
| Uses non-recursive, whitelisted file watchers | Follow symlinks or watch arbitrary paths |

---

## The Agent Squad

Agents communicate only through files in `data/` — never by calling each other
directly. The General coordinates via `data/squad-state.json`.

| Agent | Watches | Produces |
|-------|---------|---------|
| **The Librarian** | `~/Downloads`, `.git/`, `data/` | `FileSignal`, `GitCommitSignal` |
| **The Ethnographer** | `new_file.json`, local system APIs | `USER_IDENTITY.md`, `enriched_signal.json` |
| **The Secretary** | `data/signals/` | Windows toast notifications |
| **The Chronicler** | `git-commit-signal.json` | 4 social drafts per commit |
| **The Strategist** | `git-commit-signal.json` | `deep-dive.md`, `pm-tutorial.md`, `decision-log.md` |
| **Domain Agents** | Domain-specific signals | Structured action plans in `strategy-vault/` |
| **The Monitor** | `squad-state.json`, agent logs | Live terminal dashboard (2s refresh) |

→ [SOUL.md](SOUL.md) for the full squad doctrine.

---

## Signal Flow

```
~/Downloads
  ├── FileSignal ──► Ethnographer ──► USER_IDENTITY.md ──► Secretary ──► toast
  └── Domain signal ──► Domain Agent ──► action plan ──► Secretary ──► toast

.git/COMMIT_EDITMSG
  └── GitCommitSignal ──┬──► Chronicler ──► 4 drafts ──► Secretary ──► Gilded Toast
                        └──► Strategist ──► 3 vault docs
```

All state lives in `data/`. Nothing crosses a network boundary.
End-to-end latency (measured): ~3–5 seconds from file event to toast on screen.

---

## Auto-Start

Register Aura as a Windows startup process and git pre-commit hook in one command:

```powershell
.\scripts\register-scheduler.ps1
```

Installs `Aura\DaemonAtLogin` (startup), `Aura\DaemonHealthCheck` (every 30 min),
and `.git/hooks/pre-commit` (health-check before every commit).

---

## Advanced Docs

| Document | Contents |
|----------|---------|
| [docs/PRODUCT_THESIS.md](docs/PRODUCT_THESIS.md) | Problem, constraint, tradeoffs, target personas, deprioritized |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Agent model, signal flow, file-based coordination rationale, extensibility |
| [docs/EVALUATION_PLAN.md](docs/EVALUATION_PLAN.md) | Hypotheses, success criteria, instrumentation, review cadence |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 1,000-commit doctrine, near/medium/long-term, explicitly deprioritized |

---

## Architecture Details

<details>
<summary>Directory layout</summary>

```
aura/
├── CLAUDE.md              ← Project constitution
├── SOUL.md                ← The General's doctrine
├── HEARTBEAT.md           ← Live operations log
├── USER_IDENTITY.md       ← Living user identity document
│
├── src/
│   ├── index.ts           ← Bootstrap
│   ├── types/index.ts     ← All shared TypeScript interfaces
│   ├── agents/            ← Agent runners
│   └── services/          ← Gateway, watcher, dispatcher
│
├── scripts/               ← PowerShell automation
├── config/                ← Runtime config + watcher whitelist
├── agents/secretary/      ← Draft output + strategy vault
└── data/                  ← All runtime state (git-ignored)
```
</details>

<details>
<summary>Vibe Check engine</summary>

The Ethnographer tokenises each filename against four tone lexicons:

| Tone | Example filenames | Notification style |
|------|-------------------|--------------------|
| `Academic/Professional` | `Q3_budget_review.xlsx`, `thesis_draft.pdf` | *"Fitting for a scholar of your stature."* |
| `Creative/Hacker` | `brand_v3_final.png`, `prototype_hack.js` | *"The hacker in you never rests."* |
| `Developer/Technical` | `api_spec_v2.json`, `docker_compose.yml` | *"Technical payload received."* |
| `Personal/Life` | `insurance_scan.pdf`, `vacation_photos.zip` | *"Even scholars attend to life's administrivia."* |

Confidence = primary tone score as a percentage of total token matches.
</details>

---

## The 1,000-Commit Mission

Aura is being built toward **1,000 meaningful commits** as a first milestone — not
as a vanity metric, but as a discipline: ship small, ship often, make every unit of
progress reviewable.

Track the full operations log in [HEARTBEAT.md](HEARTBEAT.md).

---

## Build in Public

Aura uses itself. Every commit to this repo triggers The Chronicler, which generates
the build-in-public drafts for the thread. The system documents its own construction.

Follow the build: [Twitter](#) · [LinkedIn](#) · [Substack](#)

---

*Built with TypeScript + Node.js ESM. Windows notifications via BurntToast
PowerShell. No external APIs. The Scholar's context is the Scholar's alone.*
