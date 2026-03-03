# Architecture — Aura LCI

---

## Agent Model

Aura is a **multi-agent system** where each agent is an independent Node.js
process with a single, bounded responsibility.

| Agent | Responsibility | Entry point |
|-------|---------------|-------------|
| The Librarian | File-system watching — Downloads, git | `src/agents/librarian.ts` |
| The Ethnographer | Signal processing — vibe check, identity update | `src/agents/ethnographer.ts` |
| The Secretary | Notification composition and dispatch | `src/agents/secretary.ts` |
| The Chronicler | Build-in-public draft generation per commit | `src/agents/chronicler.ts` |
| The Strategist | PM/local-first constraint analysis per commit | `src/agents/strategist.ts` |
| Domain Agents | Domain-specific classification and action plan generation | e.g. `src/agents/financial-advisor.ts` |
| The Monitor | Live terminal dashboard | `src/agents/monitor.ts` |

**Why separate processes over a monolith?**

Each agent can be started, stopped, upgraded, or replaced independently. The
Librarian runs as a persistent daemon; the Ethnographer runs as a single-shot scan.
Neither knows the other exists. The coupling is entirely through shared files.

---

## File-Based Communication

Agents communicate exclusively by reading and writing JSON files in `data/signals/`.
No agent calls another agent's functions. No shared in-process state.

```
Agent A writes:   data/signals/new_file.json
Agent B watches:  data/signals/
Agent B reads:    data/signals/new_file.json
Agent B writes:   data/signals/enriched_signal.json
```

**Why file-based over IPC or message queues?**

Three reasons drove this decision:

1. **Durability** — if an agent crashes mid-pipeline, the last-written signal file
   survives. The next agent to start picks up where the pipeline left off. A
   message queue broker would require explicit dead-letter handling.

2. **Debuggability** — any signal can be inspected with a text editor or `cat`.
   The entire system state is human-readable at rest. This is particularly valuable
   in a system where the developer and the user are often the same person.

3. **Zero infrastructure** — no broker, no serialization library, no port
   management. The file system is the message bus.

**The latency cost**: file watcher debounce adds ~100–2000ms depending on the
signal type. At human-cadence signal generation (a file download, a git commit),
this cost is irrelevant. At real-time or high-frequency scale, this decision
would be revisited.

---

## Signal Flow

```
~/Downloads (new file)
       │
       ▼
[Librarian] — detects event, writes FileSignal
       │
       ├──► data/signals/new_file.json
       │           │
       │           ▼
       │    [Ethnographer] — vibe check, updates USER_IDENTITY.md
       │           │
       │           ▼
       │    data/signals/enriched_signal.json
       │           │
       │           ▼
       │    [Secretary] — composes Midnight Scholar greeting → toast
       │
       └──► data/signals/financial-file-signal.json (if financial)
                   │
                   ▼
            [Financial Advisor] — scores, generates plan
                   │
                   ▼
            data/signals/wealth-action-plan.json
                   │
                   ▼
            [Secretary] → toast

.git/COMMIT_EDITMSG (new commit)
       │
       ▼
[Librarian GitWatcher] — runs git log + git show, writes GitCommitSignal
       │
       ▼
data/signals/git-commit-signal.json
       │
       ├──► [Chronicler] — parses commit, generates 4 draft files
       │           │
       │           ▼
       │    agents/secretary/drafts/<shortHash>/
       │           │
       │           ▼
       │    data/signals/drafts-ready.json
       │           │
       │           ▼
       │    [Secretary] → Gilded Toast
       │
       └──► [Strategist] — theme detection, generates 3 vault docs
                   │
                   ▼
            agents/secretary/strategy-vault/<shortHash>/
```

**End-to-end latency** (measured): ~3–5 seconds from file event to toast on screen.

---

## Determinism Guarantees

The system makes the following guarantees:

- **Idempotent outputs** — both the Chronicler and Strategist check for existing
  output directories before generating. Re-running on the same commit hash is safe.
- **Atomic notification queue writes** — the Secretary writes to a `.tmp` file
  then renames to `queue.json`, preventing partial reads.
- **Deduplication** — the Secretary checks the pending queue for matching filenames
  before enqueuing. Duplicate signals do not produce duplicate toasts.
- **Signal isolation** — the Librarian ignores its own output files to prevent
  feedback loops (`new_file.json` and `librarian-events.jsonl` are explicitly
  excluded from the data watcher).

---

## Failure Handling

| Failure mode | Behaviour |
|-------------|-----------|
| Agent crashes | Auto-restart via `health-check.ps1` (every 30 min) and pre-commit hook |
| Signal file malformed | Agent logs `ERROR`, sets status to `error`, does not crash |
| Notification dispatch fails | Dead-letter queue in `data/notifications/dead-letter.jsonl` |
| Toast dispatch primary fails | Falls back to WinForms balloon tip |
| git log fails on initial commit | Falls back to `git show --stat HEAD` |

Agent statuses (`idle`, `running`, `error`) are written to `data/squad-state.json`
after every action. The Monitor reads this file every 2 seconds.

---

## Domain Agent Extensibility

The Financial Advisor is the reference implementation of a **domain agent**. The
pattern is a four-step pipeline:

```
1. DETECT   src/utils/financial-detection.ts
            classifyFinancialFile(filename, fullPath, sizeBytes)
            → FinancialFileSignal | null

2. SCORE    relevanceScore: 0–100
            institution detection, category classification, keyword matching

3. GENERATE generateWealthActionPlan(signal, identity)
            reads USER_IDENTITY.md for context
            produces structured Markdown action plan

4. SIGNAL   writes WealthActionPlanSignal to data/signals/
            Secretary watches → dispatches toast
```

To implement a new domain agent:

1. Fork `src/utils/financial-detection.ts` — replace keyword lists and category
   types with your domain's vocabulary
2. Fork `src/agents/financial-advisor.ts` — replace the action plan templates with
   your domain's output format
3. Add the new signal type to `src/types/index.ts`
4. The Secretary and Monitor will pick it up automatically via the signal file

The domain agent is fully self-contained. It does not need to be registered with
any central orchestrator — it reads from `data/signals/` and writes back to it.

---

## Scalability Path

The current architecture is optimized for single-user, single-machine, human-cadence
signal generation. The following changes would be needed to scale:

| Scaling dimension | Current approach | Required change |
|------------------|-----------------|----------------|
| Multi-user | Not supported | Per-user `data/` directories, identity isolation |
| High-frequency signals | File watcher debounce | Event queue (e.g. Redis Streams) |
| Cross-device sync | Not supported | Explicit consent model, encrypted local-to-local sync |
| macOS / Linux | Windows-only (BurntToast) | Platform abstraction for notification dispatch |
| LLM enrichment | Template-driven | Optional local model layer (Ollama, llama.cpp) |

None of these require changes to the agent communication protocol. The file-based
signaling pattern scales horizontally by adding agents; the coordination overhead
is O(n) file writes, not O(n²) network calls.

---

*See also: [PRODUCT_THESIS.md](PRODUCT_THESIS.md) · [EVALUATION_PLAN.md](EVALUATION_PLAN.md) · [ROADMAP.md](ROADMAP.md)*
