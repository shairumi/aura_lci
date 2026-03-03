# Roadmap — Aura LCI

---

## The 1,000-Commit Doctrine

Aura is being built toward **1,000 meaningful commits** as a first milestone.

This is not a vanity metric. It represents:

- **Shipping discipline** — small, reviewable units of progress over big-bang
  releases
- **Continuous validation** — each commit runs the Chronicler and Strategist,
  generating real outputs that the system uses to document itself
- **Proof of longevity** — a 1,000-commit codebase demonstrates that the
  architecture is maintainable, not just launchable

Current count: tracked in [HEARTBEAT.md](../HEARTBEAT.md).

---

## Near-Term (Next 30–60 Days)

### Get the first 10 external installs
The system is currently used by one person. The evaluation plan cannot be
validated without real users. Priority: reduce install friction (GIF demo in
README, simplify prerequisites documentation) and share in build-in-public thread.

### Record the GIF demo
A 30-second screen recording showing: commit → Gilded Toast fires → four draft
files appear in `agents/secretary/drafts/<hash>/`. This is the single highest-ROI
missing piece from the README.

### macOS notification support
Replace BurntToast (Windows-only) with a platform abstraction layer. macOS:
`osascript` for basic notifications or `terminal-notifier` for rich notifications.
This opens the project to the macOS-dominant developer persona.

### Instrumentation baseline (W1)
Deploy the `data/logs/usage-events.jsonl` instrumentation defined in
[EVALUATION_PLAN.md](EVALUATION_PLAN.md). Establish baseline metrics before
any product changes.

---

## Medium-Term (60–180 Days)

### Optional local LLM enrichment layer
The Chronicler currently uses template-driven draft generation. An optional LLM
layer using a locally-running model (Ollama, llama.cpp, or similar) would improve
draft quality without breaking the zero-egress guarantee — all inference stays
on-device.

This would be implemented as an opt-in flag:
```bash
npm run chronicler -- --llm-enrich
```

Drafts without the flag remain template-driven. The zero-egress guarantee is
preserved in both modes.

### Second domain agent reference implementation
The Financial Advisor demonstrates the pattern for one domain. A second
implementation — legal document classification is the most likely candidate, given
the same filename-detection approach applies — would validate that the domain agent
pattern is genuinely reusable, not just described as such.

### Cross-platform notification abstraction
Refactor `src/services/dispatcher.ts` into a platform abstraction with three
implementations: Windows (BurntToast), macOS (osascript), and Linux (libnotify).
The Secretary calls the abstraction; platform specifics are isolated.

---

## Long-Term (180+ Days)

### Copilot+ PC alignment
Microsoft's Copilot+ PC platform exposes NPU inference APIs for on-device AI.
Aura's zero-egress architecture is a natural fit: replace template-driven generation
with NPU-accelerated local inference. No API keys, no cloud dependency, improved
output quality.

This requires investigation of the Windows ML / DirectML APIs and whether
Node.js can interface with them directly or via a native addon.

### Cross-device sync with explicit consent model
Aura is currently single-machine. A user with multiple devices would need to
manually copy `USER_IDENTITY.md` and `data/`. A consent-driven sync mechanism —
local network only, user-initiated, encrypted — would extend the value without
compromising the zero-egress guarantee.

### Telemetry-free usage metrics collection
An optional, fully local metrics dashboard — no external analytics service — that
aggregates the `usage-events.jsonl` data into a weekly summary. Surfaces the
evaluation plan metrics without sending data anywhere.

---

## Explicitly Deprioritized

These items are out of scope and will remain so unless the product thesis changes:

**Cloud sync** — contradicts the zero-egress constraint. Not being considered.

**Mobile** — the primary persona (developer, build-in-public) works on desktop.
Mobile requires a different notification architecture and a different file watching
approach. Deferred indefinitely.

**Multi-user** — the identity model is per-user and per-machine by design.
Multi-user would require rethinking the data model, the file structure, and the
privacy guarantees. Not in scope for v1 or v2.

**SaaS / hosted version** — explicitly out of scope. The product thesis depends
on local processing. A hosted version would be a different product.

**Browser extension** — does not fit the local agent architecture. Deferred.

---

*See also: [PRODUCT_THESIS.md](PRODUCT_THESIS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [EVALUATION_PLAN.md](EVALUATION_PLAN.md)*
