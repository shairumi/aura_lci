/**
 * The Strategist — Agent Entry Point
 * Mission 6: The Strategy Vault
 *
 * Consumes:
 *   • data/signals/git-commit-signal.json  (from The Librarian / GitWatcher)
 *   • USER_IDENTITY.md                     (from The Ethnographer)
 *
 * Applies a Product Manager + local-first constraint lens to every commit.
 * Theme detection is diff-weighted: actual code changes count 3× vs metadata.
 *
 * Generates three strategy documents per commit:
 *   • deep-dive.md    — What this commit teaches, industry parallels, prior art
 *   • pm-tutorial.md  — Builder's Note: patterns, lessons, related work
 *   • decision-log.md — Trade-off ADR anchored to this commit
 *
 * Saves to:  agents/secretary/strategy-vault/{shortHash}/
 * Signals:   data/signals/strategy-vault.json  (read by The Secretary)
 *
 * Privacy: reads only local files. No network calls. No external APIs.
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
import type {
  GitCommitSignal,
  SquadState,
  StrategyVaultSignal,
  LocalFirstTheme,
} from '../types/index.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT    = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const DATA_DIR        = join(PROJECT_ROOT, 'data');
const SIGNALS_DIR     = join(DATA_DIR, 'signals');
const LOGS_DIR        = join(DATA_DIR, 'logs');
const SQUAD_STATE     = join(DATA_DIR, 'squad-state.json');
const GIT_COMMIT_SIG  = join(SIGNALS_DIR, 'git-commit-signal.json');
const STRATEGY_SIGNAL = join(SIGNALS_DIR, 'strategy-vault.json');
const USER_IDENTITY   = join(PROJECT_ROOT, 'USER_IDENTITY.md');
const VAULT_BASE      = join(PROJECT_ROOT, 'agents', 'secretary', 'strategy-vault');

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [DATA_DIR, SIGNALS_DIR, LOGS_DIR, VAULT_BASE]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
  const ts   = new Date().toISOString();
  const line = `[${ts}] [strategist] [${level}] ${message}`;
  console.log(line);
  appendFileSync(join(LOGS_DIR, 'strategist.log'), line + '\n', 'utf-8');
}

function updateSquadStatus(status: 'idle' | 'running' | 'error'): void {
  try {
    if (!existsSync(SQUAD_STATE)) return;
    const state = JSON.parse(readFileSync(SQUAD_STATE, 'utf-8')) as SquadState;
    (state.agentStatus as Record<string, string>)['strategist'] = status;
    state.lastSync = new Date().toISOString();
    writeFileSync(SQUAD_STATE, JSON.stringify(state, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

function formatDate(isoTs: string): string {
  return new Date(isoTs).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

function toPublicNames(files: string[]): string[] {
  return files.map(f => basename(f));
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

// ─── Diff Content Extraction ──────────────────────────────────────────────────

/**
 * Extract meaningful content from a unified diff.
 * Returns only added (+) and removed (-) lines, stripped of the diff prefix.
 * This gives the theme detector actual code/text to score against.
 */
function extractDiffContent(diff: string): string {
  if (!diff) return '';
  return diff
    .split('\n')
    .filter(line => (line.startsWith('+') || line.startsWith('-')) &&
                    !line.startsWith('+++') && !line.startsWith('---'))
    .map(line => line.slice(1))
    .join(' ')
    .toLowerCase();
}

/**
 * Count non-overlapping occurrences of a keyword in text.
 */
function countOccurrences(text: string, keyword: string): number {
  if (!keyword || !text) return 0;
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(keyword, pos)) !== -1) {
    count++;
    pos += keyword.length;
  }
  return count;
}

// ─── Local-First Theme Detection ──────────────────────────────────────────────

const THEME_SIGNALS: Record<LocalFirstTheme, string[]> = {
  'local-first': [
    'local', 'on-device', 'offline', 'edge', 'embedded', 'filesystem', 'readfilesync',
    'writefilesync', 'existssync', 'mkdirsync', 'appendfilesync', 'fs.', 'localfile',
  ],
  'privacy-preserving': [
    'privacy', 'private', 'telemetry', 'consent', 'pii', 'encrypt', 'secret',
    'anonymi', 'gdpr', 'notrack', 'nolog', 'sensitive', 'redact',
  ],
  'latency-optimized': [
    'latency', 'perf', 'performance', 'fast', 'speed', 'cache', 'optim',
    'debounce', 'throttle', 'batch', 'awaitmatch', 'awaitwritefinish',
  ],
  'personalization': [
    'personal', 'identity', 'profile', 'context', 'preference', 'adapt', 'tailor',
    'user_identity', 'useridentity', 'vibe', 'tone', 'lexicon', 'displayname',
  ],
  'zero-egress': [
    'gateway', 'mock', 'local.json', 'self-host', 'on-prem',
    'localhost', 'localgateway', 'nonetwork', 'offline-first',
  ],
  'agent-coordination': [
    'agent', 'squad', 'coordinat', 'orchestrat', 'dispatch', 'signal', 'general',
    'agentnames', 'agentstate', 'agenstatus', 'squadstate', 'mission', 'lifecycle',
  ],
  'data-residency': [
    'data/', 'vault', 'signals/', 'logs/', 'squad-state', 'jsonl', 'appendfile',
    'writefile', 'json.parse', 'json.stringify', 'readfile', 'data\\',
  ],
  'offline-capable': [
    'watcher', 'chokidar', 'daemon', 'background', 'monitor', 'listen', 'poll',
    'filesystemwatcher', 'inotify', 'watch(', 'createwatcher', 'binshutdown',
  ],
};

/**
 * Detect Sovereign AI themes using diff-weighted scoring.
 * Diff content counts 3× over subject + filenames, because the actual code
 * changed tells us far more than the commit message alone.
 */
function detectThemes(signal: GitCommitSignal): LocalFirstTheme[] {
  const metaCorpus = [
    signal.subject,
    signal.body,
    ...signal.diffStats.changedFiles,
  ].join(' ').toLowerCase();

  const diffCorpus = extractDiffContent(signal.diff);

  const scores = new Map<LocalFirstTheme, number>();

  for (const [theme, keywords] of Object.entries(THEME_SIGNALS) as [LocalFirstTheme, string[]][]) {
    let score = 0;
    for (const kw of keywords) {
      // Metadata: weight 1
      score += countOccurrences(metaCorpus, kw);
      // Diff content: weight 3 (actual code changes are stronger signal)
      score += countOccurrences(diffCorpus, kw) * 3;
    }
    if (score > 0) scores.set(theme, score);
  }

  // Sort by score descending, return themes present
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([theme]) => theme);
}

// ─── User Identity Reader ─────────────────────────────────────────────────────

interface UserIdentitySnapshot {
  workMode:        string;
  activityPattern: string;
  timezone:        string;
  recentFocus:     string;
  primaryLanguage: string;
}

const IDENTITY_DEFAULTS: UserIdentitySnapshot = {
  workMode:        'developer',
  activityPattern: 'focused builder',
  timezone:        'UTC',
  recentFocus:     'AI agent systems',
  primaryLanguage: 'English',
};

function readUserIdentity(): UserIdentitySnapshot {
  try {
    if (!existsSync(USER_IDENTITY)) return IDENTITY_DEFAULTS;
    const md = readFileSync(USER_IDENTITY, 'utf-8');
    const extract = (pattern: RegExp): string =>
      md.match(pattern)?.[1]?.trim().replace(/\*\*/g, '') ?? '';

    return {
      workMode:        extract(/work[\s-]*mode[^:\n]*[:\|]\s*([^\n|*`]+)/i)        || IDENTITY_DEFAULTS.workMode,
      activityPattern: extract(/activity[\s-]*pattern[^:\n]*[:\|]\s*([^\n|*`]+)/i) || IDENTITY_DEFAULTS.activityPattern,
      timezone:        extract(/timezone[^:\n]*[:\|]\s*([^\n|*`]+)/i)              || IDENTITY_DEFAULTS.timezone,
      recentFocus:     extract(/recent[\s-]*focus[^:\n]*[:\|]\s*([^\n|*`]+)/i)     || IDENTITY_DEFAULTS.recentFocus,
      primaryLanguage: extract(/primary[\s-]*language[^:\n]*[:\|]\s*([^\n|*`]+)/i) || IDENTITY_DEFAULTS.primaryLanguage,
    };
  } catch {
    return IDENTITY_DEFAULTS;
  }
}

// ─── PM Lens ──────────────────────────────────────────────────────────────────

interface PMLens {
  themes:         LocalFirstTheme[];
  localFirstScore: number;   // 0–10
  pmInsight:      string;
}

const THEME_INSIGHT: Record<LocalFirstTheme, string> = {
  'local-first':
    "Every line written here is a line that never needs a cloud contract.",
  'privacy-preserving':
    "Privacy is not a feature. This commit treats it as a first-class architectural constraint.",
  'latency-optimized':
    "A fast local pipeline removes the need for external compute offloading. This commit tightens the on-device processing boundary.",
  'personalization':
    "Deep context from local signals only. This commit grows the identity model without a network round-trip.",
  'zero-egress':
    "The gateway stays local. This commit reinforces the zero-egress boundary — no data crosses the device perimeter.",
  'agent-coordination':
    "Multi-agent orchestration on-device is the frontier. This commit advances the squad's coordination layer.",
  'data-residency':
    "The user's data lives where they live. This commit extends the local data estate under full user control.",
  'offline-capable':
    "Offline-first is the highest form of trust. This commit works whether or not you're connected.",
};

function applyPMLens(signal: GitCommitSignal): PMLens {
  const themes       = detectThemes(signal);
  const meta         = parseConventionalCommit(signal.subject);
  const featureBonus = meta.type === 'feat' ? 2 : 0;
  const localFirstScore = Math.min(10, Math.round(themes.length * 1.5 + featureBonus));
  const pmInsight = themes.length > 0
    ? (THEME_INSIGHT[themes[0]!] ?? 'This commit advances the local-first constraint architecture.')
    : 'This commit maintains the infrastructure that makes on-device processing possible.';

  return { themes, localFirstScore, pmInsight };
}

// ─── Per-Theme Knowledge Base ─────────────────────────────────────────────────

const INDUSTRY_PARALLELS: Record<LocalFirstTheme, string> = {
  'local-first':
    `**Industry parallel**: Apple's on-device Neural Engine runs face recognition, Siri intent parsing, and autocorrect entirely in silicon — no server round-trip. Google Photos' "Magic Eraser" briefly required a cloud call; they backported it to on-device after user pushback. The pattern is consistent: cloud-first launches, on-device wins the trust battle.`,

  'privacy-preserving':
    `**Industry parallel**: Signal's sealed-sender design and iMessage's end-to-end encryption are privacy-by-architecture, not privacy-by-policy. DuckDuckGo built a $100M business on a single privacy guarantee. The lesson: privacy is not a feature toggle — it is the product's founding constraint, and users who understand it become advocates.`,

  'latency-optimized':
    `**Industry parallel**: Cloudflare Workers runs JavaScript at the edge specifically to eliminate the 100–200ms round-trip to a distant origin server. Figma moved collaborative multiplayer to edge nodes to cut sync latency below perception threshold (< 100ms). Both cases prove: latency reduction is UX, not engineering.`,

  'personalization':
    `**Industry parallel**: Netflix's recommender runs on your watch history in their cloud. Spotify's Discover Weekly runs on graph traversal across 400M users. Neither can tell you *why* they recommended something — because the model is global, not yours. A local identity model can explain every inference. That explainability gap is the sovereign AI opportunity.`,

  'zero-egress':
    `**Industry parallel**: Basecamp's "cloud exit" in 2023 (moving $3.2M/yr of AWS spend to owned hardware) reopened the build-vs-rent debate across the industry. Enterprise data residency requirements — GDPR, HIPAA, FedRAMP — have pushed major vendors including Microsoft to offer local and sovereign deployment options. Zero-egress architecture is not nostalgia — it is an emerging enterprise requirement.`,

  'agent-coordination':
    `**Industry parallel**: LangGraph and CrewAI both solve multi-agent coordination through DAG-based task routing — elegant, but cloud-hosted. AutoGPT's early demos showed agent loops running on OpenAI's API, with costs spiralling out of control. File-based coordination (what Aura does) is the Unix philosophy applied to agents: small tools, shared filesystem, composable pipelines.`,

  'data-residency':
    `**Industry parallel**: GDPR's "right to be forgotten" forces cloud platforms to build deletion pipelines across distributed storage. Aura users exercise that right by running \`rm -rf data/\`. The regulatory friction that costs cloud companies millions is trivially cheap when the data estate is a local directory. On-device data residency as a product design decision eliminates an entire class of compliance risk.`,

  'offline-capable':
    `**Industry parallel**: Notion's offline mode is a persistent product request with years of engineering debt behind it because cloud-first architecture makes offline genuinely hard to retrofit. Obsidian launched offline-first by default and captured a large share of Notion's power-user base in 18 months. Offline capability is not a nice-to-have — it is the feature that converts cloud skeptics.`,
};

const PRIOR_ART: Record<LocalFirstTheme, string> = {
  'local-first':
    `**Prior art**: Martin Kleppmann's *Local-First Software* essay (2019) defined the seven ideals — no spinners, real-time collaboration, offline, longevity, privacy, user control, and no mandatory cloud. Ink & Switch's Automerge CRDT library implements it for document sync. Aura applies the same principles to identity models: your context data is yours, works offline, no spinners.`,

  'privacy-preserving':
    `**Prior art**: Apple's Differential Privacy (2016) used randomised noise to collect aggregate statistics without identifying individuals. Google's Federated Learning trains models on-device, uploading only gradients. Both prove that useful AI inference does not require raw data centralisation — it requires better architecture. Aura's approach: don't collect in the first place.`,

  'latency-optimized':
    `**Prior art**: LMAX Disruptor (2011) showed that mechanical sympathy — understanding CPU cache lines, memory layout, and branch prediction — could outperform cloud queues by 25× for financial trading. The same principle applies to local AI: inference on a GPU that shares cache with the user's process is categorically faster than an HTTPS round-trip, regardless of the remote GPU's raw speed.`,

  'personalization':
    `**Prior art**: Recommender systems research traces to Collaborative Filtering (Goldberg et al., 1992) and content-based filtering in the 1990s Usenet era. Both assumed centralised data pooling. The open question the field has not answered: can you achieve comparable recommendation quality from a single user's local signal? Aura's 1,000-commit project is a live experiment toward that answer.`,

  'zero-egress':
    `**Prior art**: The "small pieces, loosely joined" philosophy (David Weinberger, 2002) prefigured microservices but also predicts their failure mode — when the pieces are all rented from the same cloud provider, "loosely joined" becomes "vendor-coupled." Tim Berners-Lee's Solid project (2018) attempted to re-decentralise the web around personal data pods. Aura applies the same instinct pragmatically: a single user's AI context, fully on-device.`,

  'agent-coordination':
    `**Prior art**: Actor Model (Carl Hewitt, 1973) — agents as isolated processes communicating via message passing, no shared state. Erlang/OTP industrialised this for telecoms in the 1980s (99.9999999% uptime). Aura's file-based coordination is the same pattern without the runtime: each agent is a process, \`data/signals/\` is the mailbox, JSON is the message format.`,

  'data-residency':
    `**Prior art**: The Personal Data Store concept (MIT Media Lab, 2007) proposed giving individuals control of their own data clouds. It failed because the UX was too abstract. What changed: developers understand local directories. \`data/squad-state.json\` is a personal data store that a developer can open in VS Code, grep, and reason about. Concreteness is what the 2007 vision lacked.`,

  'offline-capable':
    `**Prior art**: Service Workers (Google, 2014) brought offline capability to web apps via client-side request interception. CouchDB's replication protocol (2005) enabled sync-on-reconnect for distributed databases. Both solved offline for *network applications*. Aura's offline story is different: there is no network dependency to gracefully degrade — the system is designed to never need one.`,
};

const THEME_LESSON: Record<LocalFirstTheme, string> = {
  'local-first':
    `**What this commit teaches**: Local-first is not about removing features — it is about relocating responsibility. When you read a file instead of calling an API, you take responsibility for availability, but you gain unconditional control. Every \`readFileSync\` in this codebase is a deliberate choice: we own the I/O, so we own the outcome.`,

  'privacy-preserving':
    `**What this commit teaches**: Privacy constraints are design generators. "No data leaves the machine" sounds like a limitation. In practice, it forces every feature to be self-contained, which produces more composable, more testable, more auditable code. The privacy rule is not a cage — it is a forcing function for good architecture.`,

  'latency-optimized':
    `**What this commit teaches**: Latency work reveals the true cost model of a system. Optimising a local pipeline exposes where time actually goes — file I/O, JSON parsing, watcher debounce. These are concrete, measurable, improvable. Cloud latency is a black box. Local latency is a lesson.`,

  'personalization':
    `**What this commit teaches**: Identity is not a database table — it is a signal-processing pipeline. Every file that lands in Downloads, every git commit, every language setting is a data point. The user identity model is not filled in once — it is continuously refined. This commit adds one more refinement loop.`,

  'zero-egress':
    `**What this commit teaches**: Mock services are not a stepping stone to real services — they are a design destination. A local mock gateway that works identically to a cloud gateway proves the interface contract without incurring the dependency. If a cloud extension is ever added, the mock makes integration trivial. If it's never added, the system ships without the associated complexity.`,

  'agent-coordination':
    `**What this commit teaches**: Coordination protocol is product design, not just engineering. How agents discover each other, pass signals, and report status shapes the user experience. File-based coordination is transparent — a user can watch \`data/signals/\` in a terminal and see the squad thinking in real time. That observability is a feature, not a side effect.`,

  'data-residency':
    `**What this commit teaches**: Data schemas are promises. Every field written to \`data/signals/\` is a commitment the system makes to itself and to the user. Schema stability enables composability — agents can be added, removed, or rewritten without breaking the data layer. This commit writes data carefully because data outlives the code that creates it.`,

  'offline-capable':
    `**What this commit teaches**: Offline capability is not a fallback — it is the baseline. When offline is the baseline, connectivity is an enhancement, not a requirement. This changes how you design: you stop reasoning about "what happens when the network drops?" and start asking "what does the network add?" That question usually has a shorter answer than expected.`,
};

// ─── Commit-Specific Title Builders ──────────────────────────────────────────

function buildDeepDiveTitle(meta: CommitMeta, theme: LocalFirstTheme): string {
  const THEME_LABELS: Record<LocalFirstTheme, string> = {
    'local-first':        'Local-First Architecture',
    'privacy-preserving': 'Privacy-by-Architecture',
    'latency-optimized':  'Latency as a Design Constraint',
    'personalization':    'Local Personalization',
    'zero-egress':        'Zero-Egress Architecture',
    'agent-coordination': 'On-Device Agent Coordination',
    'data-residency':     'Data Residency in Practice',
    'offline-capable':    'Offline-First by Design',
  };

  const COMMIT_VERBS: Record<string, string> = {
    feat:     'Building',
    fix:      'Hardening',
    refactor: 'Clarifying',
    chore:    'Maintaining',
    docs:     'Documenting',
    perf:     'Accelerating',
    test:     'Validating',
  };

  const verb  = COMMIT_VERBS[meta.type] ?? 'Advancing';
  const label = THEME_LABELS[theme];
  const scope = meta.scope ? ` (${meta.scope})` : '';

  return `# Deep Dive: ${verb} ${label}${scope}`;
}

function buildBuilderNoteTitle(meta: CommitMeta): string {
  const descriptions: Record<string, string> = {
    feat:     `Shipping \`${meta.description.slice(0, 60)}\``,
    fix:      `Fixing \`${meta.description.slice(0, 60)}\``,
    refactor: `Cleaning Up: \`${meta.description.slice(0, 60)}\``,
    chore:    `Maintaining: \`${meta.description.slice(0, 60)}\``,
    docs:     `Writing It Down: \`${meta.description.slice(0, 60)}\``,
  };
  return `# Builder's Note: ${descriptions[meta.type] ?? meta.description.slice(0, 80)}`;
}

// ─── Design Pattern Detection ─────────────────────────────────────────────────

function detectPatterns(signal: GitCommitSignal, meta: CommitMeta): string[] {
  const corpus = [
    signal.subject, signal.body, ...signal.diffStats.changedFiles,
    extractDiffContent(signal.diff),
  ].join(' ').toLowerCase();

  const patterns: string[] = [];

  if (corpus.includes('watch') || corpus.includes('chokidar') || corpus.includes('filesystemwatcher'))
    patterns.push('Observer Pattern — file events propagate to waiting agents without polling');
  if (corpus.includes('queue') || corpus.includes('jsonl') || corpus.includes('drain'))
    patterns.push('Queue-Based Load Levelling — notifications batch into a queue, dispatcher drains at its own pace');
  if (corpus.includes('signal') && corpus.includes('json'))
    patterns.push('Blackboard Pattern — agents communicate via a shared, readable state file');
  if (corpus.includes('fallback') || corpus.includes('catch') || corpus.includes('default'))
    patterns.push('Graceful Degradation — system continues with reduced functionality when a component fails');
  if (corpus.includes('hash') || corpus.includes('shortHash') || corpus.includes('vault'))
    patterns.push('Content-Addressed Storage — outputs keyed by commit hash enable idempotent regeneration');
  if (meta.type === 'refactor' || corpus.includes('extract') || corpus.includes('utility'))
    patterns.push('Extract Function — isolating behaviour to give it a name makes it testable and reusable');
  if (corpus.includes('config') || corpus.includes('agents.json') || corpus.includes('local.json'))
    patterns.push('Externalised Configuration — runtime values in files, not code, enable zero-rebuild customisation');

  return patterns;
}

// ─── Content Generator: Deep Dive ────────────────────────────────────────────

function generateDeepDive(
  signal: GitCommitSignal,
  lens:   PMLens,
  id:     UserIdentitySnapshot,
): string {
  const meta         = parseConventionalCommit(signal.subject);
  const primaryTheme = lens.themes[0] ?? 'local-first';

  const title           = buildDeepDiveTitle(meta, primaryTheme);
  const industrySection = INDUSTRY_PARALLELS[primaryTheme];
  const priorArtSection = PRIOR_ART[primaryTheme];
  const lessonSection   = THEME_LESSON[primaryTheme];

  const publicFiles = toPublicNames(signal.diffStats.changedFiles);
  const fileSnippet = publicFiles.slice(0, 4).join(', ')
    + (publicFiles.length > 4 ? ` +${publicFiles.length - 4} more` : '');

  const additionalThemes = lens.themes.slice(1, 3).map(t =>
    `### Also touching: ${t.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}\n\n${THEME_INSIGHT[t]}`,
  ).join('\n\n');

  const COMMIT_TYPE_NARRATIVE: Record<string, string> = {
    feat:
      `This is a \`feat:\` commit — new capability shipped. In a local-first system, every new feature answers a specific question: **what can the user now do locally that previously required an external service?** This one answers that question for ${meta.scope ?? 'the system'}.`,
    fix:
      `This is a \`fix:\` commit — reliability restored. Local systems that crash push users back to cloud alternatives. Stability is not glamorous, but it is load-bearing: every bug fixed here is a reason to stay off a SaaS subscription.`,
    refactor:
      `This is a \`refactor:\` commit — the system does the same thing, but the code now says it clearly. Clarity compounds: readable code catches edge cases faster, attracts contributors sooner, and ages better than clever code.`,
    chore:
      `This is a \`chore:\` commit — maintenance done before it became a crisis. Unmaintained systems develop a smell that users notice before engineers do. This commit keeps the foundation solid.`,
    docs:
      `This is a \`docs:\` commit — knowledge made explicit. In open-source local-first AI, documentation is the activation key. A system no-one can understand will be replaced by one they can, even if the replacement is technically inferior.`,
  };

  const typeNarrative = COMMIT_TYPE_NARRATIVE[meta.type]
    ?? `This \`${meta.type}:\` commit advances the system toward its 1,000-commit milestone.`;

  return [
    title,
    ``,
    `> **Commit** \`${signal.shortHash}\` — *${signal.subject}*`,
    `> **Date**: ${formatDate(signal.commitTimestamp)} | **Branch**: \`${signal.branch}\``,
    `> **Local-First Score**: ${lens.localFirstScore}/10 | **Primary theme**: ${primaryTheme}`,
    ``,
    `---`,
    ``,
    `## What Happened`,
    ``,
    typeNarrative,
    ``,
    `**Files changed** (${signal.diffStats.filesChanged}): ${fileSnippet}`,
    `**Diff**: +${signal.diffStats.insertions} / -${signal.diffStats.deletions} lines`,
    ``,
    signal.body ? `**Commit notes**: ${signal.body}\n` : ``,
    `> *${lens.pmInsight}*`,
    ``,
    `---`,
    ``,
    `## What This Teaches`,
    ``,
    lessonSection,
    ``,
    `---`,
    ``,
    `## Industry Parallel`,
    ``,
    industrySection,
    ``,
    additionalThemes ? `---\n\n### Secondary Themes\n\n${additionalThemes}\n` : ``,
    `---`,
    ``,
    `## Prior Art`,
    ``,
    priorArtSection,
    ``,
    `---`,
    ``,
    `## The PM View`,
    ``,
    `As a product manager evaluating a local-first AI system, the key metrics differ from cloud-hosted equivalents:`,
    ``,
    `| Traditional PM Metric      | Sovereign AI Equivalent            |`,
    `|----------------------------|------------------------------------|`,
    `| Monthly Active Users       | Daily local inference runs         |`,
    `| API calls / month          | Signals processed locally          |`,
    `| Cloud spend                | $0 (the design goal)               |`,
    `| Data retention policy      | User-controlled, user-deletable    |`,
    `| Churn risk                 | Zero — no subscription to cancel  |`,
    ``,
    `The business model for local-first AI is trust-based, not usage-based. You build trust once, you maintain it with every commit. That is what this 1,000-commit project is: a trust-building exercise, one small ship at a time.`,
    ``,
    `---`,
    ``,
    `*Generated by The Strategist — Aura LCI. Builder: ${id.workMode} | ${id.timezone} | Local-First Score ${lens.localFirstScore}/10.*`,
  ].filter(Boolean).join('\n');
}

// ─── Content Generator: Builder's Note ───────────────────────────────────────

function generatePMTutorial(
  signal: GitCommitSignal,
  lens:   PMLens,
  id:     UserIdentitySnapshot,
): string {
  const meta     = parseConventionalCommit(signal.subject);
  const title    = buildBuilderNoteTitle(meta);
  const patterns = detectPatterns(signal, meta);
  const theme    = lens.themes[0] ?? 'local-first';

  const fileList = toPublicNames(signal.diffStats.changedFiles).slice(0, 4)
    .map(f => `\`${f}\``).join(', ')
    + (signal.diffStats.changedFiles.length > 4 ? ` …` : '');

  const PROBLEM_SPACE: Record<string, string> = {
    feat:
      `**Problem**: The system could not yet do ${meta.description}. Every unbuilt local capability is a reason to reach for a cloud service. This feature closes that gap.`,
    fix:
      `**Problem**: ${meta.description} was not behaving correctly. Broken behaviour in a local system is more visible than in a cloud service — the user sees it directly, with no support ticket buffer. That directness is a feature: fast feedback loop.`,
    refactor:
      `**Problem**: The code worked but did not communicate its intent clearly. Technical debt in a local system is uniquely costly — the developer *and* the user are often the same person. Confusion compounds.`,
    chore:
      `**Problem**: Maintenance deferred is maintenance debt. Unlike feature debt, maintenance debt is invisible until it causes an outage. This commit pays down the debt before the interest accrues.`,
    docs:
      `**Problem**: The system worked but someone who cloned it wouldn't know how. Undocumented local systems fail the sovereignty promise — a system you cannot understand is not truly in your control.`,
  };

  const problemSpace = PROBLEM_SPACE[meta.type]
    ?? `**Problem**: ${meta.description} needed to be addressed to keep the system coherent.`;

  const APPROACH: Record<string, string> = {
    feat:
      `**Approach**: Build it in-process, locally, with no new network dependencies. File I/O over API calls. Local state over cloud sync. The constraint is the design.`,
    fix:
      `**Approach**: Targeted fix at the defect site, minimal surface change. Verify the existing signal chain still passes unchanged. Resist the urge to refactor adjacent code — that is a separate commit.`,
    refactor:
      `**Approach**: Isolate the behaviour, give it a name, test it in isolation. The observable pipeline — signals in, signals out — must be identical before and after.`,
    chore:
      `**Approach**: Do the maintenance now while the context is fresh. Document what changed and why in the commit body so future debugging has a trail.`,
    docs:
      `**Approach**: Write at commit time when the mental model is accurate. Docs written later drift from reality; docs written now are ground truth.`,
  };

  const approach = APPROACH[meta.type]
    ?? `**Approach**: Implement directly, keep scope tight, verify the pipeline unchanged.`;

  const patternSection = patterns.length > 0
    ? `## Patterns in Play\n\n${patterns.map(p => `- ${p}`).join('\n')}`
    : '';

  const BUILDER_ADVICE: Record<string, string> = {
    feat:
      `Ship it, then watch the signal pipeline for unexpected side effects. New features in event-driven systems often trigger signals you did not anticipate. Add a log entry to every new code path — observability is cheaper to build now than to retrofit later.`,
    fix:
      `Write a regression test or at minimum a log statement at the fix site. Bugs that are fixed without a record tend to re-appear. The git commit message is the minimum viable record — make it descriptive enough that future-you can grep for it.`,
    refactor:
      `Run the full signal chain before and after. Not unit tests alone — the full end-to-end pipeline. Refactors that pass unit tests but break integration are the most expensive class of defect in agent systems.`,
    chore:
      `Document the "why now" in the commit body. Maintenance commits without context look like noise in git history. With context, they become useful markers: "this is when we updated X because Y was deprecated."`,
    docs:
      `Link the documentation to the code it describes. Docs without anchors drift. If you document a function, mention the function name. If you document a workflow, cite the file path. Linkage enables automated freshness checks.`,
  };

  const builderAdvice = BUILDER_ADVICE[meta.type]
    ?? `Keep scope tight. Every commit should answer one question. This one answers: ${meta.description}.`;

  const RELATED_READING: Record<LocalFirstTheme, string> = {
    'local-first':
      `- *Local-First Software* — Kleppmann et al. (Ink & Switch, 2019)\n- *Designing Data-Intensive Applications* — Martin Kleppmann (O'Reilly)\n- Automerge CRDT library — local-first sync without a server`,
    'privacy-preserving':
      `- *The Age of Surveillance Capitalism* — Shoshana Zuboff\n- Apple Platform Security Guide — on-device ML architecture\n- *Privacy Is Hard and Seven Other Myths* — Jaap-Henk Hoepman`,
    'latency-optimized':
      `- LMAX Disruptor whitepaper — mechanical sympathy in high-throughput systems\n- *Systems Performance* — Brendan Gregg (2nd ed.)\n- Cloudflare Workers docs — edge latency case studies`,
    'personalization':
      `- *The Filter Bubble* — Eli Pariser (the case against cloud personalisation)\n- Netflix Tech Blog: recommender system architecture\n- *Building Machine Learning Powered Applications* — Emmanuel Ameisen`,
    'zero-egress':
      `- Basecamp's *Rethinking Cloud* (2023 cloud exit post-mortem)\n- Microsoft Azure Arc docs — local and sovereign deployment patterns\n- Adrian Cockcroft's "Cloud Repatriation" talks`,
    'agent-coordination':
      `- *Designing Distributed Systems* — Brendan Burns (O'Reilly)\n- Actor Model — Carl Hewitt original paper (1973)\n- LangGraph docs — compare to file-based coordination`,
    'data-residency':
      `- GDPR text — Article 17 (right to erasure) and Article 20 (data portability)\n- Tim Berners-Lee's Solid project specification\n- *The Alignment Problem* — Brian Christian (on data provenance)`,
    'offline-capable':
      `- Offline First manifesto (offlinefirst.org)\n- CouchDB replication protocol spec\n- Jake Archibald's *The Offline Cookbook* (Service Workers patterns)`,
  };

  const relatedReading = RELATED_READING[theme];

  return [
    title,
    ``,
    `> **Commit** \`${signal.shortHash}\` — *${signal.subject}*`,
    `> **Audience**: Builders shipping local-first AI systems`,
    `> **Primary theme**: ${theme} | **Local-First Score**: ${lens.localFirstScore}/10`,
    ``,
    `---`,
    ``,
    `## The Problem Space`,
    ``,
    problemSpace,
    ``,
    `**Files touched** (${signal.diffStats.filesChanged}): ${fileList}`,
    `**Net diff**: +${signal.diffStats.insertions} / -${signal.diffStats.deletions} lines`,
    ``,
    `---`,
    ``,
    `## The Approach`,
    ``,
    approach,
    ``,
    `---`,
    ``,
    patternSection,
    patternSection ? `\n---\n` : ``,
    `## Builder Advice`,
    ``,
    builderAdvice,
    ``,
    `---`,
    ``,
    `## Aura's Signal Architecture (Reference)`,
    ``,
    `\`\`\``,
    `[Librarian]  watches filesystem  → writes data/signals/git-commit-signal.json`,
    `[Chronicler] watches signals/    → reads signal → writes agents/secretary/drafts/`,
    `[Strategist] watches signals/    → reads signal + USER_IDENTITY.md → writes strategy-vault/`,
    `[Secretary]  watches signals/    → reads ready signals → dispatches BurntToast`,
    `\`\`\``,
    ``,
    `Every agent is stateless between runs. State lives in \`data/\`. Communication is file-based. No message queues. No cloud. Fully auditable.`,
    ``,
    `---`,
    ``,
    `## Related Reading`,
    ``,
    relatedReading,
    ``,
    `---`,
    ``,
    `## The One Thing`,
    ``,
    `> *${lens.pmInsight}*`,
    ``,
    `---`,
    ``,
    `*Generated by The Strategist — Aura LCI. Builder: ${id.workMode} | ${id.recentFocus}.*`,
  ].filter(s => s !== undefined).join('\n');
}

// ─── Content Generator: Decision Log ─────────────────────────────────────────

const OPTIONS_TABLE: Record<string, string[]> = {
  feat: [
    `| **A ✓** | Implement fully in-process, locally     | Clean, testable, zero cloud dep  | Adds complexity to agent           |`,
    `| B       | Delegate to an external service         | Simpler agent code               | Violates local-first constraint    |`,
    `| C       | Defer — not needed for current scope    | Zero cost now                    | Risk: capability gap widens        |`,
  ],
  fix: [
    `| **A ✓** | Targeted fix at the defect site         | Minimal surface change           | May not address root cause         |`,
    `| B       | Defensive wrapper (catch + fallback)    | Safe, non-breaking               | Masks the real problem             |`,
    `| C       | Redesign the affected subsystem         | Fixes root cause                 | High cost, high regression risk    |`,
  ],
  refactor: [
    `| **A ✓** | Incremental refactor, same behaviour    | Low risk, reviewable diffs       | Takes longer than big-bang         |`,
    `| B       | Big-bang rewrite                        | Clean slate                      | High regression risk               |`,
    `| C       | Leave as is — accrue technical debt     | Zero cost now                    | Compound interest on complexity    |`,
  ],
  chore: [
    `| **A ✓** | Do the maintenance now                  | Prevents future rot              | No visible user-facing value       |`,
    `| B       | Automate and schedule                   | Consistent, repeatable           | Automation setup cost              |`,
    `| C       | Skip — not urgent                       | Zero cost now                    | Technical debt accumulates         |`,
  ],
  docs: [
    `| **A ✓** | Write docs at commit time               | Accurate, context-fresh          | Slows commit velocity slightly     |`,
    `| B       | Separate docs sprint                    | Dedicated focus                  | Docs lag behind code reality       |`,
    `| C       | No docs — code is self-documenting      | Zero overhead                    | Onboarding friction for others     |`,
  ],
};

const CONSEQUENCES: Record<string, string> = {
  feat:
    `- The system can now do something it could not do before — locally, without external service dependencies.\n` +
    `- Future agents or features can build on this capability without modifying the interface.\n` +
    `- Regression surface: monitor the new code path through at least one full signal cycle.`,
  fix:
    `- System reliability improves. The defect is documented in git history — a permanent, searchable record.\n` +
    `- User trust is preserved. A broken local system is more visible than a broken cloud service.\n` +
    `- Watch for the same defect class in adjacent code paths.`,
  refactor:
    `- Internal quality improves. Future features are cheaper to build on this foundation.\n` +
    `- Observable behaviour is unchanged — verify with the full existing signal chain.\n` +
    `- The code now reads closer to the architecture's intent.`,
  chore:
    `- The system is healthier. Dependencies are current. Config is clean.\n` +
    `- No observable user-facing change.\n` +
    `- Reduces the risk of future surprise failures.`,
  docs:
    `- The system is more approachable to new contributors and to the builder's future self.\n` +
    `- Documentation accuracy degrades over time — link docs to code, schedule a review cadence.\n` +
    `- Onboarding cost is reduced.`,
};

function generateDecisionLog(
  signal: GitCommitSignal,
  lens:   PMLens,
  id:     UserIdentitySnapshot,
): string {
  const meta = parseConventionalCommit(signal.subject);

  const optionRows = OPTIONS_TABLE[meta.type] ?? [
    `| **A ✓** | Implement as designed                   | Meets requirements               | Trade-offs inherent to scope       |`,
    `| B       | Alternative approach                    | Different trade-off profile      | Not selected                       |`,
    `| C       | Defer                                   | Zero cost now                    | Delays value delivery              |`,
  ];

  const alignmentScore = lens.localFirstScore;
  const alignmentLabel =
    alignmentScore >= 8 ? '🟢 Strongly Aligned' :
    alignmentScore >= 5 ? '🟡 Partially Aligned' :
    alignmentScore >= 2 ? '🟠 Infrastructure (supports alignment)' :
                          '⚪ Neutral (housekeeping)';

  const themeRows = lens.themes.length > 0
    ? lens.themes.map(t => `- **${t}**: ${THEME_INSIGHT[t]}`).join('\n')
    : `- No specific local-first themes detected. This commit supports the foundational infrastructure that enables future on-device features.`;

  const consequences = CONSEQUENCES[meta.type] ??
    `- This commit advances the project toward its 1,000-commit milestone.\n- Specific consequences depend on the implementation details.`;

  const fileList = toPublicNames(signal.diffStats.changedFiles).slice(0, 5)
    .map(f => `\`${f}\``).join(', ')
    + (signal.diffStats.changedFiles.length > 5 ? ` (+${signal.diffStats.changedFiles.length - 5})` : '');

  const forces = lens.themes.length > 0
    ? lens.themes.slice(0, 3).map(t => `- **${t}**: pull toward ${t.replace(/-/g, ' ')} architecture`).join('\n')
    : `- Consistency: keep the codebase coherent\n- Velocity: ship without blocking other work`;

  return [
    `# Decision Log — ${signal.subject}`,
    ``,
    `| Field    | Value                                              |`,
    `|----------|----------------------------------------------------|`,
    `| ADR ref  | \`${signal.shortHash}\`                           |`,
    `| Date     | ${formatDate(signal.commitTimestamp)}              |`,
    `| Branch   | \`${signal.branch}\`                              |`,
    `| Author   | ${signal.author}                                   |`,
    `| Status   | **Accepted**                                       |`,
    ``,
    `---`,
    ``,
    `## Decision`,
    ``,
    `**${meta.description}**${meta.scope ? ` *(scope: \`${meta.scope}\`)*` : ''}`,
    ``,
    `Commit type: \`${meta.type}\`${meta.isBreaking ? '  ⚠️ **BREAKING CHANGE**' : ''}`,
    ``,
    `---`,
    ``,
    `## Context`,
    ``,
    `Aura LCI is a local-first, privacy-preserving user context engine. Every architectural decision is evaluated against two constraints:`,
    ``,
    `1. **Does it stay local?** No data leaves the machine without explicit user consent.`,
    `2. **Does it compound value?** Each commit should build on the last toward the 1,000-commit milestone.`,
    ``,
    `This decision was made at commit \`${signal.shortHash}\` — ${signal.diffStats.filesChanged} file${signal.diffStats.filesChanged !== 1 ? 's' : ''} changed, +${signal.diffStats.insertions}/-${signal.diffStats.deletions} lines.`,
    ``,
    signal.body ? `**Commit notes**: ${signal.body}\n` : ``,
    `---`,
    ``,
    `## Forces`,
    ``,
    forces,
    ``,
    `---`,
    ``,
    `## Options Considered`,
    ``,
    `| Option  | Description                                     | Pros                             | Cons                               |`,
    `|---------|-------------------------------------------------|----------------------------------|------------------------------------|`,
    ...optionRows,
    ``,
    `---`,
    ``,
    `## Trade-offs Made`,
    ``,
    `| Dimension         | What Was Gained                    | What Was Traded Away                   |`,
    `|-------------------|------------------------------------|----------------------------------------|`,
    `| Privacy           | All processing stays local         | Cannot use cloud-scale training data   |`,
    `| Complexity        | Explicit, auditable logic          | More code than a managed service       |`,
    `| Velocity          | Commit shipped now                 | Possible future refactor needed        |`,
    `| Dependency surface| No new external deps               | Manual implementation of some utilities|`,
    ``,
    `---`,
    ``,
    `## Outcome`,
    ``,
    `Decision implemented as described. Files affected: ${fileList}`,
    `Net diff: ${signal.diffStats.insertions - signal.diffStats.deletions >= 0 ? '+' : ''}${signal.diffStats.insertions - signal.diffStats.deletions} lines.`,
    ``,
    `---`,
    ``,
    `## Local-First Alignment`,
    ``,
    `**Score**: ${alignmentScore}/10 — ${alignmentLabel}`,
    ``,
    `**Detected themes**:`,
    ``,
    themeRows,
    ``,
    `> *${lens.pmInsight}*`,
    ``,
    `---`,
    ``,
    `## Consequences`,
    ``,
    consequences,
    ``,
    `---`,
    ``,
    `*Generated by The Strategist — Aura LCI. Builder: ${id.workMode} | ${id.activityPattern} | ${id.timezone}.*`,
  ].join('\n');
}

// ─── Core: Generate Strategy Vault ────────────────────────────────────────────

function generateStrategyVault(signal: GitCommitSignal): void {
  updateSquadStatus('running');
  log(`=== The Strategist: analysing commit ${signal.shortHash} ===`);
  log(`Subject: "${signal.subject}"`);

  const lens = applyPMLens(signal);
  log(`Themes: ${lens.themes.join(', ') || 'none'} | Local-first score: ${lens.localFirstScore}/10`);

  const meta        = parseConventionalCommit(signal.subject);
  const isStrategic = lens.themes.length > 0 || meta.type === 'feat' || meta.type === 'refactor';
  if (!isStrategic) {
    log(`Commit ${signal.shortHash} does not surface local-first themes — vault skipped`, 'WARN');
    updateSquadStatus('idle');
    return;
  }

  const identity = readUserIdentity();
  log(`User context: ${identity.workMode} | ${identity.timezone}`);

  const vaultDir = join(VAULT_BASE, signal.shortHash);
  if (existsSync(vaultDir)) {
    log(`Strategy vault already exists for ${signal.shortHash} — skipping`, 'WARN');
    updateSquadStatus('idle');
    return;
  }
  mkdirSync(vaultDir, { recursive: true });

  const deepDive    = generateDeepDive(signal, lens, identity);
  const pmTutorial  = generatePMTutorial(signal, lens, identity);
  const decisionLog = generateDecisionLog(signal, lens, identity);

  writeFileSync(join(vaultDir, 'deep-dive.md'),    deepDive,    'utf-8');
  writeFileSync(join(vaultDir, 'pm-tutorial.md'),  pmTutorial,  'utf-8');
  writeFileSync(join(vaultDir, 'decision-log.md'), decisionLog, 'utf-8');

  log(`Strategy vault written → agents/secretary/strategy-vault/${signal.shortHash}/`);
  log('  • deep-dive.md    — What this commit teaches + industry parallels + prior art');
  log('  • pm-tutorial.md  — Builder\'s Note: patterns, advice, related reading');
  log('  • decision-log.md — Trade-off ADR');

  const vaultSignal: StrategyVaultSignal = {
    ts:             new Date().toISOString(),
    agent:          'strategist',
    shortHash:      signal.shortHash,
    subject:        signal.subject,
    detectedThemes: lens.themes,
    localFirstScore: lens.localFirstScore,
    pmInsight:      lens.pmInsight,
    vaultDir:       `agents/secretary/strategy-vault/${signal.shortHash}`,
    outputs:        ['deep-dive.md', 'pm-tutorial.md', 'decision-log.md'],
  };

  const serialised = JSON.stringify(vaultSignal, null, 2);
  writeFileSync(join(vaultDir, 'vault-signal.json'), serialised, 'utf-8');
  writeFileSync(STRATEGY_SIGNAL, serialised, 'utf-8');
  log('StrategyVaultSignal written → vault-signal.json + data/signals/strategy-vault.json');

  updateSquadStatus('idle');
  log(`=== The Strategist: vault sealed for ${signal.shortHash}. ===`);
}

// ─── History Mining ───────────────────────────────────────────────────────────

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

function buildSignalFromHash(hash: string): GitCommitSignal | null {
  try {
    const metaRaw = gitExec(`git log -1 --format="%H%n%h%n%s%n%an%n%ae%n%cI" ${hash}`);
    if (!metaRaw) return null;

    const [commitHash = hash, shortHash = hash.slice(0, 7), subject = '',
           author = '', authorEmail = '', commitTimestamp = ''] = metaRaw.split('\n');

    const body         = gitExec(`git log -1 --format=%b ${hash}`);
    const branch       = gitExec('git rev-parse --abbrev-ref HEAD');
    const diff         = gitExec(`git show ${hash} --unified=3`);
    const shortStatRaw = gitExec(`git log -1 --shortstat ${hash}`);
    const changedFiles = gitExec(
      `git diff-tree --no-commit-id -r --name-only ${hash}`,
    ).split('\n').filter(Boolean);

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
 * Scan git history for milestone commits and generate strategy vault docs.
 * @param count - Maximum number of milestone commits to process (default 5).
 */
export function mineHistory(count: number = 5): void {
  ensureDirs();
  updateSquadStatus('running');
  log(`=== mineHistory: scanning for the last ${count} milestone commit(s) ===`);
  log('PM lens active — only strategically relevant commits will generate vault docs.');

  const featRaw    = gitExec(`git log --grep="^feat" --format=%H -n ${count}`);
  const featHashes = featRaw.split('\n').filter(Boolean);

  const milestones = new Map<string, true>();
  for (const h of featHashes) milestones.set(h, true);

  if (milestones.size < count) {
    const mergeRaw    = gitExec(`git log --merges --format=%H -n ${count}`);
    const mergeHashes = mergeRaw.split('\n').filter(Boolean);
    for (const h of mergeHashes) {
      if (milestones.size >= count) break;
      milestones.set(h, true);
    }
  }

  if (milestones.size === 0) {
    log('mineHistory: no milestone commits found — nothing to vault', 'WARN');
    updateSquadStatus('idle');
    return;
  }

  log(`mineHistory: found ${milestones.size} milestone(s). Engaging PM lens...`);

  let vaulted = 0;
  let skipped = 0;
  for (const hash of milestones.keys()) {
    const signal = buildSignalFromHash(hash);
    if (!signal) {
      log(`mineHistory: skipping ${hash.slice(0, 7)} — could not build signal`, 'WARN');
      skipped++;
      continue;
    }
    generateStrategyVault(signal);
    vaulted++;
  }

  log(`mineHistory: complete. ${vaulted} vault(s) generated, ${skipped} skipped.`);
  log(`  agents/secretary/strategy-vault/{shortHash}/`);
  log(`    deep-dive.md | pm-tutorial.md | decision-log.md | vault-signal.json`);
  updateSquadStatus('idle');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  ensureDirs();
  updateSquadStatus('running');
  log('=== The Strategist is online. Strategy Vault active. ===');
  log('PM lens: local-first | privacy | latency | personalisation');
  log('Theme detection: diff-weighted (3× diff vs 1× metadata)');
  log('Vault: agents/secretary/strategy-vault/');

  const watcher = createWatcher(
    {
      paths:              [SIGNALS_DIR],
      ignoreInitial:      true,
      recursive:          false,
      awaitWriteFinishMs: 300,
    },
    (event) => {
      if (event.filename !== 'git-commit-signal.json') return;
      if (event.type === 'unlink') return;

      log('Git commit signal detected. Engaging PM lens...');

      try {
        const raw    = readFileSync(GIT_COMMIT_SIG, 'utf-8');
        const signal = JSON.parse(raw) as GitCommitSignal;
        generateStrategyVault(signal);
      } catch (err) {
        log(`Failed to process git commit signal: ${String(err)}`, 'ERROR');
        updateSquadStatus('error');
      }
    },
  );

  updateSquadStatus('idle');
  log('Listening for git commit signals from The Librarian...');
  bindShutdown(watcher, 'strategist');
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
// Usage: node strategist.js                      → live-watcher mode (default)
//        node strategist.js --mine-history [N]   → batch vault mode

const mineIdx = process.argv.indexOf('--mine-history');
if (mineIdx !== -1) {
  const rawCount = parseInt(process.argv[mineIdx + 1] ?? '5', 10);
  const count    = Number.isNaN(rawCount) || rawCount < 1 ? 5 : rawCount;
  ensureDirs();
  mineHistory(count);
} else {
  main();
}
