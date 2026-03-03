# Dev Diary — Mission 8: The Ethnographer Learns to Read

**Commit 28 · feat: PDF content extraction for identity enrichment**

---

## What I Shipped

The Ethnographer now reads PDF content. Three pages maximum, entirely local, raw text never persisted — only the keyword tokens it extracts survive to `USER_IDENTITY.md`.

It sounds simple. It took three attempts to get right.

The first version read the full document. Too slow, too much memory, and the signal-to-noise ratio was terrible after page 4. The second version extracted all text and persisted it to `data/signals/` — which immediately violated the privacy constraint. Raw text on disk is surveillance infrastructure, even if it's your own disk.

The final version reads three pages, maps noun phrases against a 200-token lexicon, and discards everything else. The Librarian sets `requiresExtraction: true` on PDFs it encounters, the Ethnographer picks this flag up, and `USER_IDENTITY.md` gets two new fields: `vocabularyDomain` (the dominant topic cluster) and `recentFocusAreas` (the top 5 extracted terms).

Confidence on ambiguous filenames jumped from 48% to 91% in my test set.

---

## The Insight

The privacy constraint isn't a limitation — it's a design parameter that forced a better architecture. If I'd been allowed to ship raw text to a cloud API, I would have. It would have been faster to build. And I would have missed the insight that a 200-token lexicon outperforms full-document embedding for the identity signals I actually care about.

Constraints clarify.

---

## What's Next

Mission 9: Desktop watcher. Extend the Librarian to `~/Desktop` using the same non-recursive, whitelisted pattern. The file patterns there are different — more transient, more personal — which should generate interesting identity signals.

---

*Aura is a local-first context intelligence engine. 28 commits down, 972 to go.*
*Follow the build: [GitHub](https://github.com/shairumi/aura_lci)*
