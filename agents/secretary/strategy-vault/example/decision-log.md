# Decision Log — feat: PDF content extraction for identity enrichment

**Commit**: `a1b2c3d` · **Date**: 2026-01-15

---

## Decision 1: Page limit = 3 (not full document)

**Options considered**:
- Full document parsing
- First page only
- First 3 pages ← chosen

**Rationale**: Profiling on a 50-PDF test set showed that 94% of domain-relevant noun phrases appear in the first 3 pages. Full-document parsing added ~800ms with no signal gain. First-page-only missed context present in introductions (page 2) that proved significant for Academic/Professional classification.

**Tradeoff accepted**: A small number of documents where the relevant content appears only after page 3 will classify at lower confidence. Acceptable given the performance gain.

---

## Decision 2: Lexicon approach vs. embedding model

**Options considered**:
- 200-token keyword lexicon ← chosen
- Local embedding model (e.g., sentence-transformers via ONNX)
- Zero-shot classification via local LLM

**Rationale**: The lexicon approach is interpretable, auditable, and runs in < 50ms. Embedding models would require a 200MB+ model file and introduce a dependency on native binaries. Local LLMs would require hardware assumptions we can't make for a general OSS release. The lexicon covers 87% of the test set at launch — sufficient for the H2 accuracy hypothesis.

**Tradeoff accepted**: The lexicon has fixed coverage. Documents in domains not represented in the 200 tokens will return `Unknown/Unclassified`. This is a known gap, scheduled for expansion in a follow-up commit.

---

## Decision 3: Discard raw text at function boundary, not via deletion

**Options considered**:
- Write text to temp file, delete after processing
- Keep text in a class instance, expose `clear()` method
- Return only tokens from `extractPdfContext()` ← chosen

**Rationale**: Deleting files is not an atomic operation and can fail silently. A class with a `clear()` method relies on callers to invoke it correctly. Returning only tokens from the function makes the discard architecturally enforced — there is no mechanism by which the caller can access the raw text. This is the strongest privacy guarantee available without OS-level memory isolation.

**Tradeoff accepted**: None. This is the correct design.

---

## Metrics to Watch

| Metric | Target | How to measure |
|--------|--------|----------------|
| Extraction latency (p95) | < 500ms | `data/logs/ethnographer.log` |
| Classification confidence (ambiguous filenames) | ≥ 80% | `USER_IDENTITY.md` Confidence field |
| Lexicon coverage | ≥ 85% of test set | Manual audit at commit 50 |
