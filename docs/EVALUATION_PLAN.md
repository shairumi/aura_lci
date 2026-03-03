# Evaluation Plan — Aura LCI

> This document defines how Aura would be measured with real users. It covers
> hypotheses, success criteria, instrumentation, review cadence, guardrails,
> and the conditions that would trigger a pivot.

---

## Hypotheses

**H1 — Draft utility**
Commit-generated drafts reduce time-to-publish for build-in-public developers.
A developer who receives a ready-to-edit draft immediately after committing will
publish more frequently than one who drafts manually.

**H2 — Tone alignment**
Tone-matched notifications (Midnight Scholar persona) produce lower dismissal
rates than generic system alerts. Users habituate less quickly to notifications
that match their working style.

**H3 — Zero-egress as a trust signal**
The zero-egress guarantee increases install conversion among privacy-conscious
developers. Explicit architectural guarantees ("no network calls in any agent —
read the source") convert skeptics more effectively than policy language.

**H4 — Domain agent extensibility**
The four-step domain agent pattern (Detect → Score → Generate → Signal) can be
implemented for a new domain in under two hours by a developer familiar with
TypeScript. The Financial Advisor is a sufficient reference implementation.

---

## Success Criteria

### Adoption
- ≥30% of commits result in a draft file opened within 24h
- ≥5 external installs within 30 days of public launch
- ≥1 external developer forks the domain agent pattern within 60 days

### Draft Quality
- Median edit distance between generated draft and published post: <40%
- ≥50% of generated LinkedIn posts used with minor edits (≤3 sentence changes)

### Notification Health
- Notification dismissal rate: <35%
- Active users retaining the Secretary agent after 7 days: ≥60%

### System Reliability
- Agent uptime across a 7-day period: ≥95%
- Dead-letter queue entries per 100 notifications: <5

---

## Instrumentation

All instrumentation is local. No data leaves the device.

**Local event log spec** — append-only JSONL at `data/logs/usage-events.jsonl`:

```jsonl
{"ts":"<ISO>","event":"draft_generated","shortHash":"<hash>","platform":"twitter|linkedin|substack|medium"}
{"ts":"<ISO>","event":"draft_opened","shortHash":"<hash>","platform":"<platform>","latencyMs":<n>}
{"ts":"<ISO>","event":"notification_dismissed","agent":"secretary","channel":"in-app"}
{"ts":"<ISO>","event":"notification_acted","agent":"secretary","channel":"in-app"}
{"ts":"<ISO>","event":"domain_agent_triggered","agent":"financial-advisor","relevanceScore":<n>}
{"ts":"<ISO>","event":"agent_restart","agent":"<name>","reason":"health-check|crash"}
```

**Edit distance proxy** — on draft_opened, record the file size at open time.
On next write to the same file, record the new size. Size delta as a percentage
of original is a lightweight proxy for edit distance without reading file contents.

**Dismissal rate** — the Secretary already writes to `data/notifications/sent.jsonl`
and `dead-letter.jsonl`. Dismissal tracking requires a new `dismissed.jsonl` fed
by a system notification callback (BurntToast supports this via `-ActivatedAction`
and `-DismissedAction`).

---

## Review Cadence

**W1** — Baseline instrumentation deployed. No product changes. Establish baseline
metrics for draft generation rate, open rate, and notification dismissal.

**W2** — First instrumentation review. Identify the metric furthest from target.
Prioritize one change.

**W3** — First iteration shipped based on W1/W2 data.

**W4+** — Weekly metric review. Pivot threshold: any primary success criterion
below target for 3 consecutive weeks triggers a structured review of that
hypothesis.

---

## Guardrails

**Notification fatigue**
- Trigger: >2 notification dismissals in a single day from one user
- Response: reduce notification frequency cap from 5/day to 2/day
- Measurement: dismissal events in `dismissed.jsonl`

**Draft quality regression**
- Trigger: median edit distance rises above 60% for a given commit type
- Response: review and update the template for that commit type
- Measurement: size delta proxy from usage events

**Domain agent false-positive rate**
- Trigger: >20% of financial file detections result in no user action on the plan
- Response: raise the relevance score threshold for plan generation
- Measurement: domain_agent_triggered events vs wealth-action-plan vault entries
  opened

**Resource overhead**
- Trigger: any agent process sustaining >5% CPU or >100MB memory for >60 seconds
- Response: investigate and optimize the watcher or processing loop
- Measurement: system process monitor (out of band)

---

## Failure Conditions

These conditions indicate the current approach is not working and require a
structured pivot decision:

| Condition | Threshold | Pivot question |
|-----------|-----------|----------------|
| Draft open rate | <20% after 30 days | Are drafts generating or failing silently? Is the notification not firing? |
| Notification dismissal | >50% sustained for 2 weeks | Is the tone wrong? Is the frequency too high? Is the content irrelevant? |
| No external installs | 0 after 30 days of public listing | Is the README not converting? Is the install too complex? |
| Agent restart rate | >3 restarts/day on any agent | Is there a crash loop? Is the health-check trigger condition wrong? |
| Draft edit distance | >70% consistently | Are templates too generic? Is commit type parsing wrong? |

---

## Experiments Queued

**EX-01: Tone A/B** — Compare Midnight Scholar tone against a neutral tone for
the Secretary's file acquisition notifications. Hypothesis: Midnight Scholar tone
produces lower dismissal rate for the target persona (late-night developer).

**EX-02: Draft template variation** — Compare current template structure against
a shorter Twitter thread (2 points instead of 3). Hypothesis: shorter threads have
higher open and publish rates.

**EX-03: Commit-type framing** — Test whether `feat:` commits generate drafts with
materially higher publish rates than `chore:` commits. If true, consider suppressing
draft generation for non-feat commits by default.

**EX-04: Domain agent threshold tuning** — Test relevance score thresholds of 50,
65, and 80 for financial file detection. Identify the threshold that minimizes
false positives while preserving recall on genuine financial documents.

---

*See also: [PRODUCT_THESIS.md](PRODUCT_THESIS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [ROADMAP.md](ROADMAP.md)*
