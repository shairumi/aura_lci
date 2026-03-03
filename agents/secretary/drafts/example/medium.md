# How to Build On-Device Context Intelligence Without Storing Raw Text

*A practical constraint from Aura LCI: what happens when you can't persist user data, but still need to understand it.*

---

## The Problem

Most personalization systems work by accumulating data. The more you store, the better the model. It's a straightforward trade-off — until privacy becomes a hard constraint rather than a preference.

Aura is a local-first context engine with one absolute rule: raw user data never persists to disk. Filenames are fine. Metadata is fine. The actual *content* of a file? Never written, ever.

This creates an interesting engineering problem. PDF content extraction — the obvious next step after filename tokenisation — requires reading file content. How do you extract signal from content you refuse to store?

---

## The Solution: Extract, Map, Discard

The answer is a three-stage pipeline with a hard discard at stage three:

**Stage 1 — Extract**: Read the first three pages of the PDF using `pdf-parse`. Keep the text in memory only.

**Stage 2 — Map**: Run the in-memory text through a 200-token noun phrase lexicon. The lexicon is domain-specific (Academic, Developer, Financial, Personal) and maps terms to identity signals. `"amortization"` maps to `Financial`. `"refactor"` maps to `Developer`. `"ethnography"` maps to `Academic`.

**Stage 3 — Discard**: The raw text variable goes out of scope. Only the keyword tokens — a small `string[]` — survive to `USER_IDENTITY.md`.

```typescript
async function extractPdfContext(filePath: string): Promise<string[]> {
  const buffer = await fs.promises.readFile(filePath);
  const { text } = await pdfParse(buffer, { max: 3 }); // 3 pages max
  const tokens = mapToLexicon(text, IDENTITY_LEXICON);
  // text goes out of scope here — never written to disk
  return tokens;
}
```

---

## What Changed in Practice

Before content extraction, the Ethnographer's confidence on ambiguous filenames averaged 48%. After:

| Filename | Before | After |
|----------|--------|-------|
| `notes.pdf` | 31% (unclear) | 78% (Academic) |
| `summary.pdf` | 44% (unclear) | 91% (Financial) |
| `draft.pdf` | 38% (unclear) | 83% (Creative) |

The lexicon did the work. The 200-token limit kept it fast (< 200ms on an average PDF). The discard step kept the privacy constraint clean.

---

## The Broader Pattern

If you're building any on-device intelligence system, the constraint "never persist raw content" forces you to be precise about what signal you actually need. In most cases, you don't need the content — you need a few tokens from it.

Design for the minimum viable signal, not the maximum available data.

---

*Aura LCI is open source. The full implementation is at [github.com/shairumi/aura_lci](https://github.com/shairumi/aura_lci).*
