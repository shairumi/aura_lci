# Contributing to Aura LCI

Aura is designed to be extended. This guide covers three contribution paths:
extending domain intelligence, adding social draft templates, and porting
notifications to new platforms. There's also a section for AI PM readers who
want to run the evaluation experiments.

---

## For Developers

### 1. Add a Domain Agent

Domain agents follow a four-step pattern: **Detect → Score → Generate → Signal**.
The Financial Advisor (`src/agents/financial-advisor.ts`) is the reference
implementation. Here's how to build a new one.

**Step 1 — Create your agent file**

```
src/agents/<domain>-advisor.ts
src/utils/<domain>-detection.ts   ← optional, extract detection logic here
```

**Step 2 — Implement the four steps**

```typescript
// 1. DETECT — classify the incoming file
function detectDomainFile(signal: FileSignal): boolean {
  const keywords = ['keyword1', 'keyword2'];
  const name = signal.filename.toLowerCase();
  return keywords.some(k => name.includes(k));
}

// 2. SCORE — assess relevance (0–100)
function scoreDomainFile(signal: FileSignal): number {
  let score = 50; // base
  if (signal.extension === '.pdf') score += 20;
  // add keyword scoring...
  return Math.min(score, 100);
}

// 3. GENERATE — produce structured output using identity context
function generateActionPlan(signal: FileSignal, identity: string): string {
  // read USER_IDENTITY.md for context, write markdown output
  return `# ${signal.filename} — Action Plan\n\n...`;
}

// 4. SIGNAL — notify The Secretary
function emitSignal(planPath: string): void {
  const signal = { type: 'domain-plan-ready', planPath, timestamp: new Date().toISOString() };
  fs.writeFileSync('data/signals/domain-signal.json', JSON.stringify(signal, null, 2));
}
```

**Step 3 — Add your npm script to `package.json`**

```json
"<domain>-advisor": "node dist/agents/<domain>-advisor.js"
```

**Step 4 — Register in `src/index.ts`**

Add your agent's status key to `agentStatus` so The Monitor can track it.

```typescript
const agentStatus = {
  // ...existing agents...
  '<domain>-advisor': 'idle' as AgentStatus,
};
```

**Privacy constraint**: domain agents must never make network calls and must
write outputs only to `data/` or `agents/secretary/strategy-vault/`.

---

### 2. Add a Social Draft Template

The Chronicler (`src/agents/chronicler.ts`) generates drafts from conventional
commit messages. To add a new platform template:

**Step 1 — Find the template section** in `src/agents/chronicler.ts`:

```typescript
// Look for: function generateDrafts(signal: GitCommitSignal): DraftSet
```

**Step 2 — Add your template function**:

```typescript
function generateMastodonDraft(signal: GitCommitSignal): string {
  const { subject, diffStats, shortHash } = signal;
  return [
    `🔧 Just shipped: ${subject}`,
    ``,
    `+${diffStats.insertions} lines / -${diffStats.deletions} lines across ${diffStats.filesChanged} files`,
    ``,
    `#buildinpublic #localfirst #${shortHash}`,
  ].join('\n');
}
```

**Step 3 — Add the output file** to the `writeDrafts()` call:

```typescript
fs.writeFileSync(path.join(draftDir, 'mastodon.txt'), generateMastodonDraft(signal));
```

**Step 4 — Update `DraftSet` type** in `src/types/index.ts` if needed.

---

### 3. Cross-Platform Notifications

The Secretary dispatches notifications via `src/services/dispatcher.ts`. The
current implementation targets Windows (BurntToast + balloon fallback). To add
support for another platform:

**macOS (osascript)**:

```typescript
// In dispatcher.ts, detect platform:
if (process.platform === 'darwin') {
  const script = `display notification "${body}" with title "${title}" subtitle "${subject}"`;
  execSync(`osascript -e '${script}'`);
  return;
}
```

**Linux (libnotify)**:

```typescript
if (process.platform === 'linux') {
  execSync(`notify-send "${title}" "${subject}: ${body}"`);
  return;
}
```

Add your platform check before the existing Windows block. Keep all dispatch
synchronous — the Secretary does not await promises.

---

## For AI PM Readers

Aura ships with a structured evaluation plan (`docs/EVALUATION_PLAN.md`) covering
four hypotheses. Here's how to run the experiments yourself.

### Run the Evaluation Experiments

**EX-01 — Commit-to-draft latency** (tests H1: < 10s end-to-end)

```bash
npm run librarian &
npm run chronicler &
# Make a commit and measure time to draft file creation
git commit -m "feat: test commit for EX-01"
# Check agents/secretary/drafts/<shortHash>/ — timestamp diff = latency
```

**EX-02 — Identity accuracy** (tests H2: tone confidence ≥ 80%)

```bash
npm run librarian &
npm run ethnographer &
# Copy a file with a clear tone to ~/Downloads (e.g., "quarterly_report.pdf")
cp scripts/demo-assets/q3-statement.pdf ~/Downloads/quarterly_report.pdf
# Check USER_IDENTITY.md Active Focus for confidence score
```

**EX-03 — Domain detection precision** (tests H3: ≥ 85% correct classification)

```bash
npm run financial-advisor &
# Run the demo script to simulate 3 financial documents
pwsh ./scripts/demo-finance.ps1
# Each file should produce a wealth-action-plan.md in agents/secretary/strategy-vault/finance/
```

**EX-04 — Notification delivery** (tests H4: < 1% drop rate)

Check `data/logs/secretary.log` after running any signal through the pipeline.
Count `dispatched` vs `dead-letter` entries.

### Instrument with `usage-events.jsonl`

To track usage events for evaluation, append structured entries to
`data/logs/usage-events.jsonl` from any agent:

```typescript
const event = {
  ts: new Date().toISOString(),
  event: 'draft_generated',
  agentId: 'chronicler',
  commitHash: signal.shortHash,
  draftCount: 4,
  latencyMs: Date.now() - startTime,
};
fs.appendFileSync('data/logs/usage-events.jsonl', JSON.stringify(event) + '\n');
```

### Fork for a New Domain

The fastest way to extend Aura:

1. Fork the repo
2. Follow the **Add a Domain Agent** guide above for your domain
3. Update `docs/PRODUCT_THESIS.md` with your domain's hypothesis
4. Run EX-03 equivalent for your domain's signal
5. Open a PR — share your domain agent with the community

---

## General Guidelines

### Conventional Commits

All commits must use a Conventional Commits prefix:

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature or agent |
| `fix:` | Bug fix |
| `chore:` | Tooling, config, dependency updates |
| `docs:` | Documentation changes |
| `refactor:` | Code restructure without behaviour change |
| `test:` | Test additions or changes |

### PR Checklist

Before opening a pull request, verify:

- [ ] `npm run build` compiles with zero errors (`tsc --strict`)
- [ ] No PII in any tracked file — no real names, real filenames, real institution names
- [ ] No network calls added to any agent (`fetch`, `axios`, `http.get`, etc.)
- [ ] New agents write logs to `data/logs/<agent>.log`
- [ ] New watched paths are whitelisted in `config/watcher.json`
- [ ] `package-lock.json` is committed if dependencies changed
- [ ] Commit message follows Conventional Commits

### What We Don't Accept

- Outbound network calls from agent logic (privacy constraint — non-negotiable)
- Cloud sync or telemetry features
- Dependencies without a clear reason in the commit message
- Breaking changes to `data/` schema without a migration path

---

*Questions? Open an issue. Build something? Open a PR.*
