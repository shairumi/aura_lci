/**
 * The Chronicler — Agent Entry Point
 * Mission 5: The Dev Chronicle
 *
 * Watches data/signals/git-commit-signal.json (written by The Librarian's GitWatcher).
 * For every new commit signal, generates three build-in-public drafts:
 *
 *   • twitter.txt   — punchy thread (hook + 3 numbered points + CTA)
 *   • linkedin.txt  — professional reflection with context
 *   • substack.md   — insider diary (Diary → Insight → Request)
 *   • medium.md     — GEO-optimized narrative (Problem → Solution → Data)
 *
 * Drafts are saved to: agents/secretary/drafts/<shortHash>/
 * A DraftsReadySignal is written to data/signals/drafts-ready.json
 * to trigger The Secretary's Gilded Toast.
 *
 * Privacy: reads only local git data. No network calls. No external APIs.
 */

import { resolve, join, basename } from 'path';
import {
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'fs';
import { execSync } from 'child_process';
import { createWatcher, bindShutdown } from '../services/watcher.js';
import type { GitCommitSignal, DraftsReadySignal, SquadState } from '../types/index.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT   = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const DATA_DIR       = join(PROJECT_ROOT, 'data');
const SIGNALS_DIR    = join(DATA_DIR, 'signals');
const LOGS_DIR       = join(DATA_DIR, 'logs');
const SQUAD_STATE    = join(DATA_DIR, 'squad-state.json');
const GIT_COMMIT_SIG = join(SIGNALS_DIR, 'git-commit-signal.json');
const DRAFTS_READY   = join(SIGNALS_DIR, 'drafts-ready.json');
const DRAFTS_BASE    = join(PROJECT_ROOT, 'agents', 'secretary', 'drafts');
const ARCHIVE_BASE   = join(DRAFTS_BASE, 'archive');
const VAULT_BASE     = join(PROJECT_ROOT, 'agents', 'secretary', 'strategy-vault');

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [DATA_DIR, SIGNALS_DIR, LOGS_DIR, DRAFTS_BASE]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
  const ts   = new Date().toISOString();
  const line = `[${ts}] [chronicler] [${level}] ${message}`;
  console.log(line);
  appendFileSync(join(LOGS_DIR, 'chronicler.log'), line + '\n', 'utf-8');
}

function updateSquadStatus(status: 'idle' | 'running' | 'error'): void {
  try {
    if (!existsSync(SQUAD_STATE)) return;
    const state = JSON.parse(readFileSync(SQUAD_STATE, 'utf-8')) as SquadState;
    state.agentStatus['chronicler' as keyof typeof state.agentStatus] = status;
    state.lastSync = new Date().toISOString();
    writeFileSync(SQUAD_STATE, JSON.stringify(state, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

// ─── Conventional Commit Parsing ──────────────────────────────────────────────

interface CommitMeta {
  type: string;
  scope: string | null;
  description: string;
  isBreaking: boolean;
}

function parseConventionalCommit(subject: string): CommitMeta {
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!match) {
    return { type: 'chore', scope: null, description: subject, isBreaking: false };
  }
  return {
    type:        match[1] ?? 'chore',
    scope:       match[2] ?? null,
    description: match[4] ?? subject,
    isBreaking:  match[3] === '!',
  };
}

function commitTypeToPlainEnglish(type: string): string {
  const map: Record<string, string> = {
    feat:     'Added a new feature',
    fix:      'Fixed a bug',
    chore:    'Performed maintenance work',
    docs:     'Updated documentation',
    refactor: 'Refactored code structure',
    test:     'Added or updated tests',
    perf:     'Improved performance',
    ci:       'Updated CI/CD pipeline',
    build:    'Updated the build system',
    style:    'Applied code style changes',
  };
  return map[type] ?? 'Made changes';
}

// ─── Draft Helpers ────────────────────────────────────────────────────────────

function formatDate(isoTs: string): string {
  return new Date(isoTs).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function fileListBullets(files: string[], max = 5): string {
  const shown = files.slice(0, max);
  const more  = files.length - shown.length;
  const bullets = shown.map((f) => `• ${f}`).join('\n');
  return more > 0 ? `${bullets}\n• ...and ${more} more` : bullets;
}

// ─── Path Sanitization ────────────────────────────────────────────────────────

/**
 * Strip directory prefixes from file paths for all public-facing content.
 * e.g. "src/agents/chronicler.ts" → "chronicler.ts"
 */
function toPublicNames(files: string[]): string[] {
  return files.map(f => basename(f));
}

/**
 * Remove diff header lines that expose internal file paths
 * (diff --git, index, --- a/, +++ b/).
 * Keeps hunk headers (@@) and all actual code change lines (+/-).
 */
function sanitizeDiff(diff: string): string {
  return diff
    .split('\n')
    .filter(line =>
      !line.startsWith('diff --git') &&
      !line.startsWith('index ')     &&
      !line.startsWith('--- ')       &&
      !line.startsWith('+++ ')
    )
    .join('\n')
    .trim();
}

// ─── Draft: Twitter Thread ────────────────────────────────────────────────────

function generateTwitterThread(signal: GitCommitSignal): string {
  const meta = parseConventionalCommit(signal.subject);
  const { filesChanged, insertions, deletions } = signal.diffStats;
  const changedFiles = toPublicNames(signal.diffStats.changedFiles);

  const scopeTag = meta.scope ? `[${meta.scope}] ` : '';
  const typeEmoji: Record<string, string> = {
    feat: '✨', fix: '🐛', chore: '🔧', docs: '📝',
    refactor: '♻️', test: '✅', perf: '⚡', ci: '🤖', build: '🏗️',
  };
  const emoji = typeEmoji[meta.type] ?? '🚀';

  return [
    `🧵 Just shipped ${scopeTag}${meta.description} [${signal.shortHash}]`,
    ``,
    `1/ ${commitTypeToPlainEnglish(meta.type)} ${emoji}`,
    meta.isBreaking ? `⚠️ Breaking change — review before upgrading.` : `Non-breaking update. Safe to pull.`,
    ``,
    `2/ What changed:`,
    fileListBullets(changedFiles, 5),
    ``,
    `3/ The numbers:`,
    `📁 ${filesChanged} file${filesChanged !== 1 ? 's' : ''} | ➕ ${insertions} added | ➖ ${deletions} removed`,
    ``,
    `Building @AuraLCI in public — local-first AI that knows you without knowing you.`,
    `Commit ${signal.shortHash} of 1,000. 🛤️`,
    ``,
    `#BuildInPublic #LocalAI #TypeScript #IndieHacker`,
  ].join('\n');
}

// ─── Vault Insight Reader ─────────────────────────────────────────────────────

/**
 * Try to read the Strategist's pmInsight for this commit from its
 * per-commit vault-signal.json. Returns null when the vault has not
 * yet been generated (e.g. Strategist hasn't run for this commit).
 */
function readVaultInsight(shortHash: string): string | null {
  try {
    const sigPath = join(VAULT_BASE, shortHash, 'vault-signal.json');
    if (!existsSync(sigPath)) return null;
    const raw = readFileSync(sigPath, 'utf-8');
    const sig = JSON.parse(raw) as { pmInsight?: string };
    return sig.pmInsight?.trim() || null;
  } catch {
    return null;
  }
}

// ─── Draft: LinkedIn Post ────────────────────────────────────────────────────

function generateLinkedInPost(signal: GitCommitSignal): string {
  const meta = parseConventionalCommit(signal.subject);
  const { filesChanged, insertions, deletions } = signal.diffStats;
  const changedFiles = toPublicNames(signal.diffStats.changedFiles);
  const scopeSuffix = meta.scope ? ` (${meta.scope})` : '';

  const typeContext: Record<string, string> = {
    feat:
      `This feature expands the system's capability — bringing Aura one step closer to a truly intelligent local context engine. In local-first software, every new feature is also a privacy question: what data does it touch, where does it live, and who controls it?`,
    fix:
      `Every bug fixed is a reliability win. Software quality compounds one fix at a time. A system users can trust is a system users will use.`,
    chore:
      `Maintenance work is the unsung hero of sustainable software. Invisible until it breaks. This commit keeps the machine running smoothly.`,
    docs:
      `Good documentation is a gift to your future self. Written today, appreciated tomorrow. Every line of docs is an act of respect for the next reader.`,
    refactor:
      `Clean code is not a luxury. Refactoring now prevents technical debt from compounding. This commit makes the system easier to reason about — and easier to extend.`,
    test:
      `Tests are documentation that runs. This commit strengthens the safety net, making future changes safer and faster to ship.`,
    perf:
      `Performance is a feature. Every millisecond saved compounds across thousands of interactions. In a local-first system, speed is also an architectural feature — fast local processing reduces the need to offload compute to external services.`,
    ci:
      `Good CI/CD is invisible infrastructure. Automation frees engineers to do what humans do best: think about hard problems.`,
  };
  const context = typeContext[meta.type] ??
    `Progress is progress — small commits compound into large systems. Every step counts on the road to 1,000.`;

  const filesList = changedFiles.slice(0, 6).map((f) => `  • ${f}`).join('\n');
  const moreFiles = changedFiles.length > 6 ? `  • ...and ${changedFiles.length - 6} more\n` : '';

  // Check Strategist's vault for a PM insight to use as the opening hook.
  // Falls back to the default opener when the vault hasn't been generated yet.
  const pmInsight   = readVaultInsight(signal.shortHash);
  const openingHook = pmInsight ?? `Another brick laid in the wall. 🧱`;

  return [
    openingHook,
    ``,
    `Today's commit to Aura LCI — "${signal.subject}"${scopeSuffix}`,
    ``,
    context,
    ``,
    `What changed:`,
    filesList,
    moreFiles,
    `Technical snapshot:`,
    `→ ${filesChanged} file${filesChanged !== 1 ? 's' : ''} | ${insertions} additions | ${deletions} removals`,
    `→ Branch: ${signal.branch}`,
    `→ Commit: \`${signal.shortHash}\` · ${formatDate(signal.commitTimestamp)}`,
    ``,
    `Part of my build-in-public journey toward 1,000 commits on Aura — a local-first AI that builds a living model of your context, entirely on-device.`,
    ``,
    `What's your current milestone target? 👇`,
    ``,
    `#BuildingInPublic #SoftwareEngineering #LocalAI #TypeScript #IndieHacker`,
  ].join('\n');
}

// ─── Draft: Substack — "Diary → Insight → Request" ──────────────────────────

function generateSubstackPost(signal: GitCommitSignal): string {
  const meta = parseConventionalCommit(signal.subject);
  const { filesChanged, insertions, deletions } = signal.diffStats;
  const changedFiles = toPublicNames(signal.diffStats.changedFiles);
  const netDelta = insertions - deletions;

  // Hook: journey-focused, first-person, honest
  const diaryHooks: Record<string, string> = {
    feat:     `I shipped a new feature today — and the most interesting part wasn't the code.`,
    fix:      `Today I hunted down a bug. It took longer than it should have. Here's what I found.`,
    chore:    `Not every commit is glamorous. Today's was maintenance — and I'm glad I did it.`,
    docs:     `I wrote documentation today. I know, I know. But hear me out.`,
    refactor: `I tore apart some code I wrote earlier. Future me will thank present me. Probably.`,
    test:     `I spent today writing tests. In a multi-agent system, tests feel less like bureaucracy and more like insurance.`,
    perf:     `I made Aura faster today — not by offloading to the cloud, but by thinking harder about what the local machine can do.`,
    ci:       `Automation day. Less visible code, more infrastructure. The kind of commit that makes everything else easier.`,
  };

  const diaryNarratives: Record<string, string> = {
    feat:
      `The change itself was ${insertions + deletions < 50 ? 'compact' : 'substantial'} — ${filesChanged} file${filesChanged !== 1 ? 's' : ''}, ${insertions} lines added, ${deletions} removed. But every new feature in a local-first system forces the same question: what does this touch, and where does that data live?\n\nIn Aura's case, the answer must always be: local. On your machine. Under your control. Writing "${signal.subject}" meant holding that constraint the whole way through — no cloud round-trips, no silent callbacks, no "optional" telemetry.`,
    fix:
      `Bugs in local-first systems are a specific kind of humbling. There's no "the server was slow" or "the API was flaky." When something breaks, it's the code. This fix touched ${filesChanged} file${filesChanged !== 1 ? 's' : ''} — ${insertions} lines added, ${deletions} removed. The root cause was ${meta.scope ? `in the ${meta.scope} layer` : 'in the core logic'}. Simple in retrospect. Always is.`,
    chore:
      `Maintenance commits don't get celebrated. Nobody tweets "just updated my dependencies." But in a codebase that makes privacy promises, a stale dependency is a potential vulnerability. ${filesChanged} file${filesChanged !== 1 ? 's' : ''} touched today — ${insertions} additions, ${deletions} removals. The system is a little healthier for it.`,
    docs:
      `I wrote documentation for ${meta.scope ? `the ${meta.scope} system` : 'the core architecture'} today. ${insertions} new lines. I kept asking: who is this for? Future contributors, probably. But also future me — six months from now, wondering why I made a particular decision. Good docs are a gift to your future self.`,
    refactor:
      `Refactoring is the most honest form of progress. No new features, no user-visible changes — just the work of making the code say what it means. Today's refactor touched ${filesChanged} file${filesChanged !== 1 ? 's' : ''}, ${insertions} lines added, ${deletions} removed. Net delta: ${netDelta >= 0 ? '+' : ''}${netDelta}. Sometimes you need to add lines to make something cleaner.`,
    test:
      `I added tests for ${meta.scope ? `the ${meta.scope} layer` : 'the core agent logic'} today — ${insertions} new lines of test code. In a multi-agent system, tests aren't just regressions guards. They're documentation that runs. Every test is a statement about what the system *should* do. And in a privacy-first system, that matters more than usual.`,
    perf:
      `Performance work in a local-first system is different from cloud optimization. I can't throw more servers at the problem — I have to think harder about what the machine already has. Today's commit trimmed ${deletions > insertions ? deletions - insertions : netDelta > 0 ? `+${netDelta}` : Math.abs(netDelta)} lines of overhead and made Aura's processing pipeline a little leaner.`,
    ci:
      `Infrastructure day. The CI pipeline now does something it didn't before. ${filesChanged} file${filesChanged !== 1 ? 's' : ''} changed, ${insertions} lines added. Not glamorous — but every improvement here multiplies the value of every future commit.`,
  };

  const insights: Record<string, string> = {
    feat:
      `The thing I keep relearning while building Aura: local-first isn't a constraint — it's a forcing function for better design. When you can't phone home, you have to think more carefully about what the system actually needs to know. Features get sharper. Data flows get cleaner. The architecture gets more honest.\n\nBuilding in public forces me to articulate this with every commit. That's uncomfortable, and useful.`,
    fix:
      `The gap between "working" and "reliable" is where most local-first systems fail. Cloud products can paper over reliability gaps with retries and fallbacks. Local systems can't. Every bug fix is a reliability investment — and reliability is the only foundation trust can be built on.`,
    chore:
      `The 1,000-commit goal isn't just about shipping features. It's about building a system that's still worth using at commit 1,000. Maintenance commits are how you get there. Every chore commit is a vote for the long game.`,
    docs:
      `I've been thinking about documentation as a privacy feature. If users can't understand what the system does, they can't give meaningful consent. Good docs close that gap. They're not just for engineers — they're for anyone who wants to know what's actually happening on their machine.`,
    refactor:
      `The most interesting thing about refactoring a multi-agent system: you discover the implicit contracts between agents. Assumptions buried in implementation details become visible when you try to move them. This refactor surfaced assumptions I didn't know I was making. That's valuable, even if the change looks small from the outside.`,
    test:
      `In a local-first system, test coverage has a dual role. It catches regressions, yes. But it also makes the privacy promise verifiable. "We don't send your data anywhere" is an assertion. Tests can turn that assertion into evidence. That's the distinction I'm building toward.`,
    perf:
      `Every performance improvement in Aura strengthens the case for on-device inference. If the local system is fast enough, there's no need to move data off-device — not for the user, not for the developer. Performance is how you make the right choice also the convenient one.`,
    ci:
      `Good CI/CD is how you make a 1,000-commit goal survivable. Without automation, the quality pressure compounds. With automation, each commit gets a safety net. The goal doesn't get easier — but it gets more tractable.`,
  };

  const hookLine  = diaryHooks[meta.type]     ?? `Another commit in the books. Here's what happened.`;
  const diary     = diaryNarratives[meta.type] ?? `Today's commit — "${signal.subject}" — advanced Aura's local-first architecture. ${filesChanged} files, ${insertions} additions, ${deletions} removals.`;
  const insight   = insights[meta.type]        ?? `Every commit on a 1,000-commit journey teaches you something. Sometimes about the code. Sometimes about the architecture. Sometimes about your own assumptions.`;

  const fileTable = changedFiles.length > 0
    ? changedFiles.map((f) => `| \`${f}\` | modified |`).join('\n')
    : `| *(no files listed in diff stats)* | — |`;

  const MAX_DIFF_LINES = 80;
  const cleanDiff   = sanitizeDiff(signal.diff);
  const diffLines   = cleanDiff.split('\n');
  const trimmedDiff = diffLines.length > MAX_DIFF_LINES
    ? diffLines.slice(0, MAX_DIFF_LINES).join('\n') + '\n... [truncated — see full diff in git log]'
    : cleanDiff;

  const bodySection = signal.body
    ? `### Commit Notes\n\n${signal.body}\n\n`
    : '';

  return [
    `# Commit \`${signal.shortHash}\`: ${meta.description}`,
    ``,
    `> *${hookLine}*`,
    ``,
    `> **Commit** \`${signal.shortHash}\` · **Branch** \`${signal.branch}\` · **Date** ${formatDate(signal.commitTimestamp)}`,
    ``,
    `---`,
    ``,
    `## 📔 The Diary`,
    ``,
    diary,
    ``,
    bodySection,
    `## 💡 The Insight`,
    ``,
    insight,
    ``,
    `## 🗂️ The Raw Data`,
    ``,
    `| File | Status |`,
    `|------|--------|`,
    fileTable,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Files Changed | ${filesChanged} |`,
    `| Lines Added | +${insertions} |`,
    `| Lines Removed | -${deletions} |`,
    `| Net Delta | ${netDelta >= 0 ? '+' : ''}${netDelta} |`,
    ``,
    `<details>`,
    `<summary>Raw diff (click to expand)</summary>`,
    ``,
    `\`\`\`diff`,
    trimmedDiff,
    `\`\`\``,
    ``,
    `</details>`,
    ``,
    `---`,
    ``,
    `## 🙋 Your Turn`,
    ``,
    `This is commit \`${signal.shortHash}\` on my build-in-public journey toward **1,000 commits** on Aura LCI — a local-first AI that builds a living model of your context, entirely on-device. No cloud. No data egress.`,
    ``,
    `If you're building something that respects user privacy — or struggling with the tradeoffs — I want to hear about it. Reply, leave a comment, or just share this.`,
    ``,
    `**Share this with one dev who hates cloud-first AI.**`,
    ``,
    `---`,
    ``,
    `*The Chronicler — one of Aura's internal agents — generated this draft automatically when the commit was detected. All processing is local. No external APIs.*`,
  ].join('\n');
}

// ─── Draft: Medium — "Problem → Solution → Data" (GEO-Optimized) ─────────────

function generateMediumPost(signal: GitCommitSignal): string {
  const meta = parseConventionalCommit(signal.subject);
  const { filesChanged, insertions, deletions } = signal.diffStats;
  const changedFiles = toPublicNames(signal.diffStats.changedFiles);
  const netDelta  = insertions - deletions;
  const scopeLabel = meta.scope ?? 'core';

  // Industry-level headlines — designed for GEO / AI Overview discoverability
  const headlines: Record<string, string> = {
    feat:     `Why Every New Feature in Consumer AI Is Also a Privacy Decision`,
    fix:      `The Hidden Cost of "Ship Fast, Fix Later" in Privacy-First Software`,
    chore:    `The Unsexy Work That Keeps AI Products Trustworthy`,
    docs:     `Why Documentation Is a Privacy Feature, Not an Afterthought`,
    refactor: `Clean Code Is a Privacy Strategy: How Architecture Decisions Accumulate`,
    test:     `Why Test Coverage in Local-First AI Is a User-Trust Metric`,
    perf:     `Why Faster Local AI Reduces Dependency on External Compute`,
    ci:       `How Automation Infrastructure Protects the Local-First Promise`,
  };

  const industryProblems: Record<string, string> = {
    feat:
      `The consumer AI industry faces a structural tension: the more personalized an AI becomes, the more data it typically requires — and centralized data creates compliance exposure, user trust risk, and infrastructure cost. Most products accept this as a fixed constraint.\n\nThe open design question in 2026: how much context can a system build from local signals only, without centralizing data? Aura is a working exploration of that boundary.`,
    fix:
      `"Move fast and break things" was a fine philosophy when the things being broken were UI bugs. When the things being broken are user privacy guarantees, the calculus changes entirely.\n\nEvery defect in a privacy-critical system is a potential breach — not necessarily of data, but of trust. In local-first software, preventing that breach is an architectural commitment, not a post-launch patch.`,
    chore:
      `Maintenance debt is invisible until it isn't. In cloud AI, dependency rot and configuration drift are accepted costs of moving fast. In a local-first system that promises data stays on-device, those same invisible problems become visible risks: stale dependencies can introduce vulnerabilities, config drift can silently widen the attack surface.\n\nThe industry ignores this. Local-first developers can't afford to.`,
    docs:
      `Most AI products treat documentation as marketing copy. The result is users who don't understand what the software actually does with their data — and engineers who can't maintain privacy guarantees they've never written down.\n\nIn a world where AI products handle increasingly sensitive context, documentation is the contract between the system and the user. The industry hasn't caught up to this yet.`,
    refactor:
      `Technical debt in a privacy-critical codebase is a different kind of problem than in a typical SaaS app. Complex, poorly structured code is harder to audit. It accumulates hidden data flows, implicit dependencies, and assumptions that are easy to miss in a security review.\n\nThe consumer AI industry prioritizes shipping features. The local-first approach prioritizes legible architecture — because legibility and auditability are the same thing.`,
    test:
      `In consumer AI, users extend trust based on brand promises, not technical evidence. But brand promises erode. The only durable form of trust is a system that demonstrably works as advertised.\n\nIn a local-first multi-agent system, test coverage is the difference between "we promise your data stays local" and "we can prove it." The industry hasn't made that distinction clearly enough.`,
    perf:
      `Cloud-hosted AI has structural advantages: elastic compute, global distribution, and shared model training at scale. Local-first AI operates under a different set of constraints — and those constraints produce a different set of properties.\n\nEvery millisecond of latency removed from local processing reduces the practical need to offload. **Performance is an architectural strategy.** The faster the on-device system, the stronger the case for keeping processing local.`,
    ci:
      `Continuous integration is invisible infrastructure — until it fails. In a local-first AI project, CI/CD isn't just about catching bugs before they ship. It's about ensuring that privacy guarantees are machine-verifiable, that no accidental network call slips through, and that the local-first promise survives every merge.\n\nMost AI teams treat CI as a development convenience. In local-first software, it's a trust mechanism.`,
  };

  const solutions: Record<string, string> = {
    feat:
      `This commit — "${signal.subject}" — extends Aura's capability without touching any external service. The new feature lives entirely on-device, processes only local signals, and adds zero data egress surface area.\n\nThat's the local-first constraint applied in practice: on-device signals are sufficient for deep context. This commit advances that proof of concept.`,
    fix:
      `This fix closes a defect in Aura's local processing pipeline. No data was transmitted externally — the bug existed entirely within the on-device layer. The fix is surgical, targeted, and leaves no new assumptions about user data in the codebase.\n\nIn a local-first system, every bug fix is also a trust repair.`,
    chore:
      `This maintenance commit keeps Aura's local-first foundation clean. No new features, no scope creep — just the steady work of keeping the system trustworthy. In a 1,000-commit journey, maintenance commits are the connective tissue that holds everything together.`,
    docs:
      `This documentation update makes Aura's local-first architecture more legible — to future contributors, to auditors, and to users who want to understand what the system actually does with their data.\n\nGood docs are a privacy feature. They close the gap between "we promise" and "you can verify."`,
    refactor:
      `This refactor improves the internal structure of Aura's local processing layer without changing observable behavior. The architecture becomes cleaner, more auditable, and easier to reason about.\n\nThat's a privacy win: clear code is auditable code. Auditability is how local-first systems earn trust over time.`,
    test:
      `This commit strengthens Aura's test coverage for the local processing layer. In a multi-agent system, good tests mean that the privacy guarantees we've promised can be verified, not just asserted.\n\nTests are the conscience of a privacy-first codebase — and the most honest form of documentation.`,
    perf:
      `This performance improvement makes Aura's local processing faster — shaving overhead from the signal pipeline without touching any external service.\n\nEvery millisecond saved reduces the practical need for off-device compute. Performance is how you make the on-device choice also the convenient one.`,
    ci:
      `This CI/CD improvement strengthens Aura's automated quality gates. Better automation means faster feedback, consistent environments, and a higher confidence that every commit preserves the local-first promise.\n\nIn a 1,000-commit build, CI is the infrastructure that makes consistency possible.`,
  };

  const headline = headlines[meta.type]        ?? `Building Local-First AI in Public: What Commit ${signal.shortHash} Reveals`;
  const problem  = industryProblems[meta.type]  ?? `The consumer AI industry is racing to build products that know users deeply. The question no one is asking loudly enough: at what cost to user privacy, and user trust?`;
  const solution = solutions[meta.type]         ?? `This commit advances Aura's local-first architecture — one step closer to an AI that knows you without surveilling you.`;

  const fileTable = changedFiles.length > 0
    ? changedFiles.map((f) => `| \`${f}\` | modified |`).join('\n')
    : `| *(no files listed)* | — |`;

  return [
    `# ${headline}`,
    ``,
    `> **Commit** \`${signal.shortHash}\` · **Branch** \`${signal.branch}\` · **Date** ${formatDate(signal.commitTimestamp)}`,
    ``,
    `---`,
    ``,
    `## The Problem`,
    ``,
    problem,
    ``,
    `## The Solution: What Aura Does Differently`,
    ``,
    solution,
    ``,
    `## The Data`,
    ``,
    `### Commit Arc`,
    ``,
    `| Attribute | Value |`,
    `|-----------|-------|`,
    `| Commit | \`${signal.shortHash}\` |`,
    `| Type | \`${meta.type}${meta.isBreaking ? ' ⚠️ breaking' : ''}\` |`,
    `| Scope | \`${scopeLabel}\` |`,
    `| Subject | ${signal.subject} |`,
    `| Branch | \`${signal.branch}\` |`,
    `| Date | ${formatDate(signal.commitTimestamp)} |`,
    ``,
    `### Change Footprint`,
    ``,
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Files Changed | ${filesChanged} |`,
    `| Lines Added | +${insertions} |`,
    `| Lines Removed | -${deletions} |`,
    `| Net Delta | ${netDelta >= 0 ? '+' : ''}${netDelta} |`,
    ``,
    `### Files Modified`,
    ``,
    `| File | Status |`,
    `|------|--------|`,
    fileTable,
    ``,
    `## Why This Matters for Consumer AI in 2026`,
    ``,
    `Aura is a working exploration of a constrained design problem: how much context can a system build from local signals only, with zero data egress? The answer, after 1,000 commits, is: more than most people expect.`,
    ``,
    `The next wave of consumer AI will be shaped by data residency requirements, user trust dynamics, and edge inference capabilities. Aura is a proof of concept for building context-aware systems under those constraints.`,
    ``,
    `That's the 1,000-commit goal. Commit \`${signal.shortHash}\` is one step.`,
    ``,
    `---`,
    ``,
    `*To see the private code, architecture decision records, and raw build logs behind this, **join my Substack**.*`,
    ``,
    `*Built with [Aura LCI](https://github.com/shairumi/aura) — Local Context Intelligence. All processing is local. No external APIs.*`,
  ].join('\n');
}

// ─── Core: Generate All Drafts ────────────────────────────────────────────────

function generateDrafts(signal: GitCommitSignal): void {
  updateSquadStatus('running');
  log(`=== The Chronicler: generating drafts for commit ${signal.shortHash} ===`);
  log(`Subject: "${signal.subject}"`);
  log(`Stats: ${signal.diffStats.filesChanged} files | +${signal.diffStats.insertions} -${signal.diffStats.deletions}`);

  const draftsDir = join(DRAFTS_BASE, signal.shortHash);

  // Deduplicate — skip if drafts already exist for this commit
  if (existsSync(draftsDir)) {
    log(`Drafts already exist for ${signal.shortHash} — skipping`, 'WARN');
    updateSquadStatus('idle');
    return;
  }

  mkdirSync(draftsDir, { recursive: true });

  const twitter  = generateTwitterThread(signal);
  const linkedin = generateLinkedInPost(signal);
  const substack = generateSubstackPost(signal);
  const medium   = generateMediumPost(signal);

  writeFileSync(join(draftsDir, 'twitter.txt'),  twitter,  'utf-8');
  writeFileSync(join(draftsDir, 'linkedin.txt'), linkedin, 'utf-8');
  writeFileSync(join(draftsDir, 'substack.md'),  substack, 'utf-8');
  writeFileSync(join(draftsDir, 'medium.md'),    medium,   'utf-8');

  log(`Drafts saved to: agents/secretary/drafts/${signal.shortHash}/`);
  log('  • twitter.txt  — punchy thread');
  log('  • linkedin.txt — professional reflection');
  log('  • substack.md  — insider diary (Diary → Insight → Request)');
  log('  • medium.md    — GEO-optimized narrative (Problem → Solution → Data)');

  // Signal The Secretary for Gilded Toast dispatch
  const readySignal: DraftsReadySignal = {
    ts:        new Date().toISOString(),
    agent:     'chronicler',
    shortHash: signal.shortHash,
    subject:   signal.subject,
    draftsDir: `agents/secretary/drafts/${signal.shortHash}`,
    drafts:    ['twitter.txt', 'linkedin.txt', 'substack.md', 'medium.md'],
  };

  writeFileSync(DRAFTS_READY, JSON.stringify(readySignal, null, 2), 'utf-8');
  log(`DraftsReadySignal written → data/signals/drafts-ready.json`);

  updateSquadStatus('idle');
  log(`=== The Chronicler: mission complete for ${signal.shortHash}. Secretary notified. ===`);
}

// ─── History Mining ───────────────────────────────────────────────────────────

/** Run a git command in the project root and return stdout, or '' on failure. */
function gitExec(cmd: string): string {
  try {
    return execSync(cmd, {
      cwd:      PROJECT_ROOT,
      encoding: 'utf-8',
      stdio:    ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/** Ensure per-platform archive subdirectories exist. */
function ensureArchiveDirs(): void {
  for (const platform of ['twitter', 'linkedin', 'substack', 'medium']) {
    const dir = join(ARCHIVE_BASE, platform);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

/**
 * Reconstruct a GitCommitSignal from a historical commit hash.
 * Returns null if git output cannot be parsed (e.g. root commit, invalid hash).
 */
function buildSignalFromHash(hash: string): GitCommitSignal | null {
  try {
    // Metadata: one field per line — %H, %h, %s, %an, %ae, %cI
    const metaRaw = gitExec(`git log -1 --format="%H%n%h%n%s%n%an%n%ae%n%cI" ${hash}`);
    if (!metaRaw) return null;

    const [commitHash = hash, shortHash = hash.slice(0, 7), subject = '',
           author = '', authorEmail = '', commitTimestamp = ''] = metaRaw.split('\n');

    const body         = gitExec(`git log -1 --format=%b ${hash}`);
    const branch       = gitExec('git rev-parse --abbrev-ref HEAD');
    const diff         = gitExec(`git show ${hash} --unified=3`);
    const shortStatRaw = gitExec(`git log -1 --shortstat ${hash}`);

    // Changed file list via diff-tree (avoids parsing --stat alignment spaces)
    const changedFiles = gitExec(
      `git diff-tree --no-commit-id -r --name-only ${hash}`,
    ).split('\n').filter(Boolean);

    // Parse "N files changed, M insertions(+), K deletions(-)"
    const statLine    = shortStatRaw.split('\n').find(l => l.includes('changed')) ?? '';
    const filesMatch  = statLine.match(/(\d+) files? changed/);
    const insertMatch = statLine.match(/(\d+) insertion/);
    const deleteMatch = statLine.match(/(\d+) deletion/);

    return {
      ts:              new Date().toISOString(),
      agent:           'librarian',
      commitHash:      commitHash.trim(),
      shortHash:       shortHash.trim(),
      subject:         subject.trim(),
      body:            body.trim(),
      author:          author.trim(),
      authorEmail:     authorEmail.trim(),
      commitTimestamp: commitTimestamp.trim(),
      branch:          branch.trim() || 'main',
      diff,
      diffStats: {
        filesChanged: parseInt(filesMatch?.[1] ?? '0', 10),
        insertions:   parseInt(insertMatch?.[1] ?? '0', 10),
        deletions:    parseInt(deleteMatch?.[1] ?? '0', 10),
        changedFiles,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Write platform-specific archive drafts for a single commit.
 * Output: agents/secretary/drafts/archive/{twitter,linkedin,substack}/{shortHash}.{ext}
 */
function writeToDraftArchive(signal: GitCommitSignal): void {
  const twitter  = generateTwitterThread(signal);
  const linkedin = generateLinkedInPost(signal);
  const substack = generateSubstackPost(signal);
  const medium   = generateMediumPost(signal);

  writeFileSync(join(ARCHIVE_BASE, 'twitter',  `${signal.shortHash}.txt`), twitter,  'utf-8');
  writeFileSync(join(ARCHIVE_BASE, 'linkedin', `${signal.shortHash}.txt`), linkedin, 'utf-8');
  writeFileSync(join(ARCHIVE_BASE, 'substack', `${signal.shortHash}.md`),  substack, 'utf-8');
  writeFileSync(join(ARCHIVE_BASE, 'medium',   `${signal.shortHash}.md`),  medium,   'utf-8');

  log(`  [${signal.shortHash}] "${signal.subject}" → archive/{twitter,linkedin,substack,medium}`);
}

/**
 * Scan git history for milestone commits and generate archive drafts for each.
 *
 * Strategy:
 *   1. Collect up to `count` commits with a `feat:` subject (build-in-public milestones).
 *   2. If fewer than `count` feat commits exist, supplement with merge commits.
 *   3. For each commit, rebuild a GitCommitSignal and run the full draft-content logic.
 *   4. Write results into agents/secretary/drafts/archive/ organised by platform:
 *        archive/twitter/{shortHash}.txt
 *        archive/linkedin/{shortHash}.txt
 *        archive/substack/{shortHash}.md
 *
 * @param count - Maximum number of milestone commits to process (default 5).
 */
export function mineHistory(count: number = 5): void {
  ensureArchiveDirs();
  updateSquadStatus('running');
  log(`=== mineHistory: scanning for the last ${count} milestone commit(s) ===`);

  // 1. Prefer feat: commits (most meaningful build-in-public milestones)
  const featRaw    = gitExec(`git log --grep="^feat" --format=%H -n ${count}`);
  const featHashes = featRaw.split('\n').filter(Boolean);

  const milestones = new Map<string, true>();
  for (const h of featHashes) milestones.set(h, true);

  // 2. Supplement with merge commits when feat commits fall short
  if (milestones.size < count) {
    const mergeRaw    = gitExec(`git log --merges --format=%H -n ${count}`);
    const mergeHashes = mergeRaw.split('\n').filter(Boolean);
    for (const h of mergeHashes) {
      if (milestones.size >= count) break;
      milestones.set(h, true);
    }
  }

  if (milestones.size === 0) {
    log('mineHistory: no milestone commits found — nothing to archive', 'WARN');
    updateSquadStatus('idle');
    return;
  }

  log(`mineHistory: found ${milestones.size} milestone(s). Generating archive drafts...`);

  let archived = 0;
  for (const hash of milestones.keys()) {
    const signal = buildSignalFromHash(hash);
    if (!signal) {
      log(`mineHistory: skipping ${hash.slice(0, 7)} — could not build signal`, 'WARN');
      continue;
    }
    writeToDraftArchive(signal);
    archived++;
  }

  log(`mineHistory: complete. ${archived} commit(s) archived to:`);
  log(`  agents/secretary/drafts/archive/twitter/`);
  log(`  agents/secretary/drafts/archive/linkedin/`);
  log(`  agents/secretary/drafts/archive/substack/`);
  log(`  agents/secretary/drafts/archive/medium/`);
  updateSquadStatus('idle');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  ensureDirs();
  updateSquadStatus('running');
  log('=== The Chronicler is online. Mission 5: The Dev Chronicle active. ===');
  log(`Drafts base directory: agents/secretary/drafts/`);

  const watcher = createWatcher(
    {
      paths:             [SIGNALS_DIR],
      ignoreInitial:     true,
      recursive:         false,
      awaitWriteFinishMs: 300,
    },
    (event) => {
      if (event.filename !== 'git-commit-signal.json') return;
      if (event.type === 'unlink') return;

      log('Git commit signal detected. Engaging drafting engine...');

      try {
        const raw    = readFileSync(GIT_COMMIT_SIG, 'utf-8');
        const signal = JSON.parse(raw) as GitCommitSignal;
        generateDrafts(signal);
      } catch (err) {
        log(`Failed to process git commit signal: ${String(err)}`, 'ERROR');
        updateSquadStatus('error');
      }
    },
  );

  updateSquadStatus('idle');
  log('Listening for git commit signals from The Librarian...');
  bindShutdown(watcher, 'chronicler');
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
// Usage: node chronicler.js               → live-watcher mode (default)
//        node chronicler.js --mine-history [count]  → batch archive mode

const mineIdx = process.argv.indexOf('--mine-history');
if (mineIdx !== -1) {
  const rawCount = parseInt(process.argv[mineIdx + 1] ?? '5', 10);
  const count    = Number.isNaN(rawCount) || rawCount < 1 ? 5 : rawCount;
  ensureDirs();
  mineHistory(count);
} else {
  main();
}
