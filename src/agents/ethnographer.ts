/**
 * The Ethnographer — Agent Entry Point
 * Operation Watchtower
 *
 * Watches data/signals/new_file.json.
 * When a new signal appears, runs a Vibe Check on the filename.
 * Updates USER_IDENTITY.md's Active Focus section.
 * Writes enriched signal to data/signals/enriched_signal.json
 * (which triggers The Secretary).
 */

import { resolve, join, extname } from 'path';
import {
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'fs';
import { createWatcher, bindShutdown } from '../services/watcher.js';
import type { FileSignal, EnrichedSignal, VibeCheckResult, SquadState } from '../types/index.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT    = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const DATA_DIR        = join(PROJECT_ROOT, 'data');
const SIGNALS_DIR     = join(DATA_DIR, 'signals');
const LOGS_DIR        = join(DATA_DIR, 'logs');
const NEW_FILE_SIG    = join(SIGNALS_DIR, 'new_file.json');
const ENRICHED_SIG    = join(SIGNALS_DIR, 'enriched_signal.json');
const IDENTITY_PATH   = join(PROJECT_ROOT, 'USER_IDENTITY.md');
const SQUAD_STATE     = join(DATA_DIR, 'squad-state.json');

// ─── Tone Lexicon ─────────────────────────────────────────────────────────────

const TONE_LEXICON: Record<string, string[]> = {
  'Academic/Professional': [
    'research', 'report', 'thesis', 'study', 'analysis', 'paper', 'review',
    'proposal', 'presentation', 'meeting', 'budget', 'invoice', 'contract',
    'memo', 'draft', 'notes', 'project', 'lci', 'roadmap', 'spec',
    'requirements', 'technical', 'documentation', 'whitepaper', 'summary',
    'brief', 'agenda', 'minutes', 'quarterly', 'annual', 'plan', 'strategy',
    'framework', 'methodology', 'curriculum', 'course', 'lecture', 'exam',
    'assignment', 'thesis', 'dissertation', 'journal', 'abstract',
  ],
  'Creative/Hacker': [
    'logo', 'design', 'sketch', 'concept', 'brand', 'vibe', 'prototype',
    'hack', 'build', 'experiment', 'idea', 'mood', 'palette', 'font', 'art',
    'portfolio', 'creative', 'v1', 'v2', 'v3', 'final', 'demo', 'proof',
    'poc', 'cool', 'awesome', 'dope', 'wild', 'wave', 'glitch', 'pixel',
    'render', 'composite', 'ui', 'ux', 'mockup', 'wireframe', 'figma',
    'illustration', 'icon', 'banner', 'poster', 'thumbnail', 'splash',
  ],
  'Personal/Life': [
    'recipe', 'photo', 'family', 'vacation', 'travel', 'birthday', 'wedding',
    'health', 'fitness', 'diary', 'memories', 'scan', 'tax', 'insurance',
    'medical', 'home', 'house', 'car', 'pet', 'shopping', 'list', 'todo',
    'personal', 'private', 'selfie', 'trip', 'holiday', 'financial', 'bill',
  ],
  'Developer/Technical': [
    'config', 'setup', 'install', 'script', 'code', 'module', 'api', 'sdk',
    'cli', 'debug', 'output', 'data', 'json', 'csv', 'xml', 'yaml',
    'readme', 'env', 'deploy', 'build', 'dist', 'src', 'lib', 'bin',
    'util', 'helper', 'schema', 'model', 'migration', 'seed', 'docker',
    'compose', 'pipeline', 'workflow', 'action', 'hook', 'test', 'spec',
  ],
};

// ─── Vibe Label Map ───────────────────────────────────────────────────────────

const VIBE_LABELS: Record<string, string> = {
  'Academic/Professional': 'The Scholar is at work',
  'Creative/Hacker':       'The Hacker is experimenting',
  'Personal/Life':         'The Human is living',
  'Developer/Technical':   'The Engineer is building',
};

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [DATA_DIR, SIGNALS_DIR, LOGS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
  const ts   = new Date().toISOString();
  const line = `[${ts}] [ethnographer] [${level}] ${message}`;
  console.log(line);
  appendFileSync(join(LOGS_DIR, 'ethnographer.log'), line + '\n', 'utf-8');
}

function updateSquadStatus(status: 'idle' | 'running' | 'error'): void {
  try {
    if (!existsSync(SQUAD_STATE)) return;
    const state = JSON.parse(readFileSync(SQUAD_STATE, 'utf-8')) as SquadState;
    state.agentStatus.ethnographer = status;
    state.lastSync = new Date().toISOString();
    writeFileSync(SQUAD_STATE, JSON.stringify(state, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

// ─── Vibe Check Engine ────────────────────────────────────────────────────────

function tokenise(basename: string): string[] {
  return basename
    .replace(extname(basename), '')            // strip extension
    .split(/[_\-\.\s\d]+/)                     // split on separators & digits
    .filter((t) => t.length > 2)
    .map((t) => t.toLowerCase());
}

function vibeCheck(filename: string): VibeCheckResult {
  const tokens  = tokenise(filename);
  const scores: Record<string, number>   = {};
  const matched: Record<string, string[]> = {};

  for (const [tone, keywords] of Object.entries(TONE_LEXICON)) {
    for (const kw of keywords) {
      if (tokens.includes(kw)) {
        scores[tone]  = (scores[tone] ?? 0) + 1;
        matched[tone] = [...(matched[tone] ?? []), kw];
      }
    }
  }

  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a);

  if (sorted.length === 0) {
    return {
      tone:            'Unknown/Unclassified',
      secondaryTone:   null,
      confidence:      0,
      keywords:        [],
      label:           'Signal unclear — The Scholar watches',
      updatedIdentity: false,
    };
  }

  const [primaryTone, primaryScore] = sorted[0]!;
  const total       = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence  = Math.round((primaryScore / total) * 100);
  const secondaryTone = sorted[1]?.[0] ?? null;

  return {
    tone:            primaryTone,
    secondaryTone,
    confidence,
    keywords:        matched[primaryTone] ?? [],
    label:           VIBE_LABELS[primaryTone] ?? 'Signal detected',
    updatedIdentity: true,
  };
}

// ─── USER_IDENTITY.md Active Focus Update ────────────────────────────────────

const FOCUS_START = '<!-- ACTIVE_FOCUS_START -->';
const FOCUS_END   = '<!-- ACTIVE_FOCUS_END -->';

function buildActiveFocusBlock(signal: FileSignal, vibe: VibeCheckResult): string {
  const ts       = new Date().toISOString();
  const sizeKB   = signal.sizeBytes ? `${(signal.sizeBytes / 1024).toFixed(1)} KB` : 'unknown size';
  const keywords = vibe.keywords.length > 0 ? vibe.keywords.join(', ') : 'none matched';

  return [
    FOCUS_START,
    '',
    '## Active Focus',
    '> Updated automatically by The Ethnographer on each new Downloads signal.',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| Filename | \`${signal.filename}\` |`,
    `| Detected Tone | **${vibe.tone}** |`,
    `| Secondary Tone | ${vibe.secondaryTone ?? 'none'} |`,
    `| Confidence | ${vibe.confidence}% |`,
    `| Vibe Label | *${vibe.label}* |`,
    `| Keywords Matched | \`${keywords}\` |`,
    `| File Size | ${sizeKB} |`,
    `| Signal Received | \`${signal.ts}\` |`,
    `| Identity Updated | \`${ts}\` |`,
    '',
    '### Ethnographer\'s Note',
    '```',
    `The acquisition of "${signal.filename}" is consistent with the`,
    `"${vibe.tone}" vibe cluster. The Midnight Scholar's active context`,
    `has been updated. The Secretary has been notified.`,
    '```',
    '',
    FOCUS_END,
  ].join('\n');
}

function updateIdentityActiveFocus(signal: FileSignal, vibe: VibeCheckResult): boolean {
  try {
    if (!existsSync(IDENTITY_PATH)) {
      log('USER_IDENTITY.md not found — cannot update Active Focus', 'WARN');
      return false;
    }

    let content = readFileSync(IDENTITY_PATH, 'utf-8');
    const newBlock = buildActiveFocusBlock(signal, vibe);

    if (content.includes(FOCUS_START) && content.includes(FOCUS_END)) {
      // Replace existing block
      const startIdx = content.indexOf(FOCUS_START);
      const endIdx   = content.indexOf(FOCUS_END) + FOCUS_END.length;
      content = content.slice(0, startIdx) + newBlock + content.slice(endIdx);
    } else {
      // Append before the Signal History section
      const insertMarker = '## 5. Signal History';
      if (content.includes(insertMarker)) {
        content = content.replace(insertMarker, newBlock + '\n\n---\n\n' + insertMarker);
      } else {
        content = content + '\n\n' + newBlock;
      }
    }

    writeFileSync(IDENTITY_PATH, content, 'utf-8');
    log(`USER_IDENTITY.md Active Focus updated → "${signal.filename}" | tone=${vibe.tone}`);
    return true;
  } catch (err) {
    log(`Failed to update USER_IDENTITY.md: ${String(err)}`, 'ERROR');
    return false;
  }
}

// ─── Signal Processor ────────────────────────────────────────────────────────

function processSignal(rawSignal: FileSignal): void {
  updateSquadStatus('running');
  log(`=== Vibe Check initiated for: ${rawSignal.filename} ===`);

  const vibe = vibeCheck(rawSignal.filename);
  log(`Vibe: ${vibe.tone} | Confidence: ${vibe.confidence}% | Keywords: [${vibe.keywords.join(', ')}]`);

  // Update USER_IDENTITY.md
  const identityUpdated = updateIdentityActiveFocus(rawSignal, vibe);

  // Build enriched signal for Secretary
  const enriched: EnrichedSignal = {
    ...rawSignal,
    processed:   true,
    vibeCheck:   { ...vibe, updatedIdentity: identityUpdated },
    enrichedAt:  new Date().toISOString(),
  };

  // Write enriched signal (triggers Secretary watcher)
  writeFileSync(ENRICHED_SIG, JSON.stringify(enriched, null, 2), 'utf-8');
  log(`Enriched signal written → data/signals/enriched_signal.json`);

  updateSquadStatus('idle');
  log(`=== Vibe Check complete. Secretary notified. ===`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  ensureDirs();
  updateSquadStatus('running');
  log('=== The Ethnographer is online. Watching data/signals/ ===');

  // Watch the signals directory for new_file.json changes
  const watcher = createWatcher(
    {
      paths: [SIGNALS_DIR],
      ignoreInitial: true,
      recursive: false,
      awaitWriteFinishMs: 300, // fast — signals are small JSON files
    },
    (event) => {
      // Only react to the Librarian's raw signal file
      if (event.filename !== 'new_file.json') return;
      if (event.type === 'unlink') return;

      log(`New signal detected: ${event.filename} | event=${event.type}`);

      try {
        const raw = readFileSync(NEW_FILE_SIG, 'utf-8');
        const signal = JSON.parse(raw) as FileSignal;

        // Skip internal/project-data events — only process Downloads signals
        if (signal.watchedRoot !== 'downloads') {
          log(`Skipping non-Downloads signal (watchedRoot=${signal.watchedRoot})`);
          return;
        }

        // Skip already-processed signals (guard against feedback loops)
        if (signal.processed) {
          log('Signal already marked processed — skipping', 'WARN');
          return;
        }

        processSignal(signal);
      } catch (err) {
        log(`Failed to process signal: ${String(err)}`, 'ERROR');
        updateSquadStatus('error');
      }
    },
  );

  updateSquadStatus('idle');
  log('Listening for Librarian signals...');
  bindShutdown(watcher, 'ethnographer');
}

main();
