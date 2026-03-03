# Product Thesis — Aura LCI

> **One-line pitch**: A local-first context intelligence system that builds a living
> model of the user's environment from on-device signals only, under a hard
> zero-egress constraint.

---

## The Problem

Consumer AI personalization has a structural dependency: the richer the model of
the user, the more data it typically requires — and that data has to live somewhere.
Most products resolve this by centralizing it on the vendor's infrastructure.

This creates a set of second-order problems that are underweighted in product design:

- **Compliance exposure** — GDPR, CCPA, HIPAA, and emerging AI regulations impose
  significant obligations on centralized personal data stores
- **User trust friction** — privacy-conscious users (a growing segment) reduce
  engagement when they distrust data handling
- **Infrastructure cost** — personalization at scale requires compute and storage
  that compounds with user growth
- **Data residency requirements** — regulated industries and enterprise deployments
  often cannot use cloud-hosted personal data at all

These are not edge cases. They are structural constraints that will shape the next
wave of consumer AI product design.

---

## The Constraint

Aura is built under a single hard constraint: **zero data egress**.

No signal, log, identity field, or notification ever leaves the device without
explicit user action. This is not a privacy policy — it is an architectural
guarantee enforced at the code level. No network calls exist in any agent.

The design question this constraint forces: **how much context can a system build
from local signals only?**

The answer Aura is exploring, across 1,000 commits: more than most people expect.

---

## Why This Constraint Is Interesting

Zero-egress architecture is not a niche concern. It maps directly to several
high-growth areas:

| Domain | Why zero-egress matters |
|--------|------------------------|
| **Edge computing** | Inference at the network edge requires local processing |
| **On-device AI** | Copilot+ PCs, Apple Silicon Neural Engine, Snapdragon NPUs |
| **Regulated industries** | Healthcare, legal, finance — cannot use cloud-hosted personal data |
| **Enterprise data residency** | GDPR, FedRAMP, HIPAA impose jurisdiction constraints on where data lives |
| **Privacy-first consumer products** | Growing segment of users who actively prefer local processing |

These are not anti-cloud positions. They are market segments with real requirements
that cloud-first architectures cannot serve without significant architectural
overhead.

---

## Why Multi-Agent?

Single-responsibility agents were chosen over a monolithic pipeline for three
reasons:

**1. Replaceability** — any agent can be swapped, upgraded, or disabled without
touching the others. The Ethnographer can be replaced with a more sophisticated
classifier; the Chronicler templates can be replaced with LLM generation; neither
change touches the others.

**2. Testability** — each agent's contract is explicit: it reads specific input
files, writes specific output files. This makes both manual inspection and
automated testing straightforward.

**3. Observability** — the squad's state is visible in `data/signals/` at all times.
A developer can watch the directory in a terminal and observe the system reasoning
in real time. Observability is a feature, not a side effect.

---

## Why File-Based Signaling?

Agents communicate by reading and writing JSON files in `data/signals/` rather
than through IPC, message queues, or direct function calls.

**The tradeoff:**

| Dimension | File-based | IPC / message queue |
|-----------|-----------|-------------------|
| Latency | ~100ms (watcher debounce) | <1ms |
| Debuggability | Open in any text editor | Requires tooling |
| Durability | Survives process crashes | Queue may lose messages |
| Complexity | None | Broker setup, serialization |
| Auditability | Full history via file system | Depends on logging |

At Aura's current scale (single user, single machine, signals generated at human
cadence), the latency cost is irrelevant. The debuggability and durability gains
are material. This decision would be revisited at multi-user or real-time scale.

---

## Target Personas

**Primary**: Solo developers and indie builders doing build-in-public. They commit
frequently, want to maintain a public presence, and currently spend disproportionate
time manually writing social posts about their work.

**Secondary**: Privacy-conscious knowledge workers who want AI context awareness
without data centralization — developers in regulated industries, researchers, and
enterprise users with data residency requirements.

**Tertiary**: Builders evaluating the pluggable domain agent architecture as a
template for their own domain (legal, medical, research).

---

## Differentiation

| Axis | Aura | Cloud-hosted alternatives |
|------|------|--------------------------|
| Data location | On-device only | Vendor infrastructure |
| API keys required | None | Yes |
| Works offline | Always | No |
| Compliance surface | Zero | Significant |
| Latency | Local I/O | Network round-trip |
| Explainability | Full (all signals local) | Limited (black-box models) |

---

## What Was Deprioritized and Why

**macOS / Linux support** — deferred. Windows-first because BurntToast provides
the richest local notification experience. Cross-platform is the clearest near-term
expansion path.

**LLM integration** — deliberately excluded from v1. Template-driven draft
generation preserves the zero-egress guarantee. An optional local LLM layer
(via Ollama or similar) is the logical next step — it would keep data on-device
while improving output quality.

**Multi-user** — out of scope. Aura is a single-user, single-machine system by
design. Multi-user would require rethinking the identity model and the data
residency guarantees.

**Cloud sync** — excluded by design. The zero-egress constraint makes this a
non-starter for v1. Cross-device sync with explicit consent model is a long-term
consideration.

**Real-time collaboration** — not relevant to the current use case.

---

## Key Risks

**1. Windows-only limits total addressable market** — mitigated by the fact that
the primary persona (developer, build-in-public) skews heavily toward macOS.
macOS support is the highest-priority expansion.

**2. Template-driven drafts have quality ceiling** — the Chronicler generates
drafts that are useful but not polished. Users will edit them. This is by design
in v1; LLM enrichment addresses it in v2 without breaking the zero-egress guarantee.

**3. No user research yet** — Aura is currently used by one person (the builder).
The evaluation plan defines the instrumentation needed to validate assumptions with
real users.

---

*See also: [ARCHITECTURE.md](ARCHITECTURE.md) · [EVALUATION_PLAN.md](EVALUATION_PLAN.md) · [ROADMAP.md](ROADMAP.md)*
