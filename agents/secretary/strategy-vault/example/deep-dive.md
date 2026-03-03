# Deep Dive — feat: PDF content extraction for identity enrichment

**Commit**: `a1b2c3d` · **Date**: 2026-01-15 · **localFirstScore**: 9/10

---

## What Was Built

This commit ships the Ethnographer's content extraction capability. The agent can now parse PDF content locally and map it to identity signals — without persisting raw text.

The implementation adds `extractPdfContext()` to `src/agents/ethnographer.ts`, which:
1. Reads up to 3 pages using `pdf-parse`
2. Maps noun phrases to a 200-token lexicon
3. Returns keyword tokens only — raw text discarded in-memory

`USER_IDENTITY.md` gains two new fields: `vocabularyDomain` and `recentFocusAreas`.

---

## Why This Scores 9/10 on Local-First Principles

This commit exemplifies the zero-egress architecture constraint at its most demanding. The system needs content — but the privacy model forbids persistence. The solution (extract → map → discard) is a direct product of the constraint.

**What it demonstrates**:
- On-device inference without model hosting: a 200-token lexicon outperforms cloud NLP for this specific classification task
- Privacy-by-architecture: the discard step isn't optional — it's baked into the function signature (returns `string[]`, not `string`)
- Constraint-driven design: the 3-page limit emerged from profiling, not arbitrary choice

---

## PM Insight

The local-first constraint is doing product work here. By forcing the team to define the minimum viable signal (tokens, not text), the constraint produced a faster, more interpretable system than a cloud-first approach would have.

This is the core thesis of the zero-egress architecture: constraints that feel like restrictions often produce better-scoped solutions.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| pdf-parse fails on malformed PDFs | Error caught, Ethnographer falls back to filename-only scoring |
| Lexicon coverage gap (unknown domain) | `Unknown/Unclassified` returned, confidence = 0% |
| Memory spike on large PDFs | 3-page limit enforced at parse time, not post-hoc |

---

## Next Steps

- Expand lexicon from 200 to 500 tokens (Mission 8 follow-up)
- Add `vocabularyDomain` trend tracking — rolling 30-day window (Mission 11)
