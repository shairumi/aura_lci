/**
 * The Secretary — Agent Entry Point
 * Operation Watchtower
 *
 * Watches data/signals/enriched_signal.json (written by The Ethnographer).
 * Composes a greeting notification in the "Midnight Scholar" tone.
 * Writes to data/notifications/queue.json.
 *
 * Tone directive (from The General — Operation First Contact):
 *   concise | analytical | occasionally irreverent
 *   No morning motivation. No patronizing checklists.
 *   Night hours are ACTIVE hours.
 */

import { resolve, join } from 'path';
import {
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
} from 'fs';
import { v4 as uuid } from 'uuid';
import { createWatcher, bindShutdown } from '../services/watcher.js';
import { drainQueue } from '../services/dispatcher.js';
import type { EnrichedSignal, DraftsReadySignal, WealthActionPlanSignal, Notification, SquadState } from '../types/index.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT     = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const DATA_DIR         = join(PROJECT_ROOT, 'data');
const SIGNALS_DIR      = join(DATA_DIR, 'signals');
const LOGS_DIR         = join(DATA_DIR, 'logs');
const NOTIFS_DIR       = join(DATA_DIR, 'notifications');
const ENRICHED_SIG     = join(SIGNALS_DIR, 'enriched_signal.json');
const DRAFTS_READY_SIG  = join(SIGNALS_DIR, 'drafts-ready.json');
const WEALTH_ACTION_SIG = join(SIGNALS_DIR, 'wealth-action-plan.json');
const QUEUE_PATH       = join(NOTIFS_DIR, 'queue.json');
const SENT_LOG         = join(NOTIFS_DIR, 'sent.jsonl');
const DEAD_LETTER_PATH = join(NOTIFS_DIR, 'dead-letter.jsonl');
const SQUAD_STATE      = join(DATA_DIR, 'squad-state.json');

// ─── Greeting Templates (Midnight Scholar tone) ───────────────────────────────

const GREETINGS_BY_TONE: Record<string, (filename: string, label: string) => string> = {
  'Academic/Professional': (f, _l) =>
    `I see you've acquired ${f}. Fitting for a scholar of your stature. Shall I index this for our local context?`,

  'Creative/Hacker': (f, _l) =>
    `I see you've acquired ${f}. Interesting artefact. The hacker in you never rests. Index it?`,

  'Personal/Life': (f, _l) =>
    `I see you've acquired ${f}. Even scholars attend to life's administrivia. Noted and logged.`,

  'Developer/Technical': (f, _l) =>
    `I see you've acquired ${f}. Technical payload received. Shall I flag this for the build context?`,

  'Unknown/Unclassified': (f, _l) =>
    `I see you've acquired ${f}. Unclassified signal. The Ethnographer is watching. Filed pending vibe resolution.`,
};

function composeGreeting(signal: EnrichedSignal): { subject: string; body: string } {
  const { filename } = signal;
  const { tone, label, confidence } = signal.vibeCheck;

  const templateFn = GREETINGS_BY_TONE[tone] ?? GREETINGS_BY_TONE['Unknown/Unclassified']!;
  const body = templateFn(filename, label);

  const subject = confidence >= 70
    ? `New acquisition — ${tone} signal detected`
    : `New acquisition — signal weak (${confidence}% confidence)`;

  return { subject, body };
}

// ─── Queue Management ─────────────────────────────────────────────────────────

function readQueue(): Notification[] {
  try {
    if (!existsSync(QUEUE_PATH)) return [];
    return JSON.parse(readFileSync(QUEUE_PATH, 'utf-8')) as Notification[];
  } catch {
    return [];
  }
}

function writeQueue(queue: Notification[]): void {
  // Atomic-ish write: write to .tmp then rename
  const tmp = QUEUE_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(queue, null, 2), 'utf-8');
  try {
    renameSync(tmp, QUEUE_PATH);
  } catch {
    // Fallback on rename failure (e.g. cross-device): direct write
    writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
  }
}

function enqueueNotification(notification: Notification): void {
  const queue = readQueue();

  // Deduplicate: don't enqueue the same filename twice if still pending
  const alreadyQueued = queue.some(
    (n) => n.metadata['filename'] === notification.metadata['filename'],
  );
  if (alreadyQueued) {
    log(`Dedup: notification for "${String(notification.metadata['filename'])}" already in queue`);
    return;
  }

  queue.push(notification);
  writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
  log(`Notification enqueued | id=${notification.id} | subject="${notification.subject}"`);

  // Append to sent log (we treat enqueue as delivery in local mock)
  const receipt = {
    id:        notification.id,
    enqueuedAt: notification.ts,
    sentAt:    new Date().toISOString(),
    channel:   notification.channel,
    subject:   notification.subject,
  };
  appendFileSync(SENT_LOG, JSON.stringify(receipt) + '\n', 'utf-8');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [DATA_DIR, SIGNALS_DIR, LOGS_DIR, NOTIFS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(QUEUE_PATH)) {
    writeFileSync(QUEUE_PATH, JSON.stringify([], null, 2), 'utf-8');
  }
}

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
  const ts   = new Date().toISOString();
  const line = `[${ts}] [secretary] [${level}] ${message}`;
  console.log(line);
  appendFileSync(join(LOGS_DIR, 'secretary.log'), line + '\n', 'utf-8');
}

function updateSquadStatus(status: 'idle' | 'running' | 'error'): void {
  try {
    if (!existsSync(SQUAD_STATE)) return;
    const state = JSON.parse(readFileSync(SQUAD_STATE, 'utf-8')) as SquadState;
    state.agentStatus.secretary = status;
    state.lastSync = new Date().toISOString();
    writeFileSync(SQUAD_STATE, JSON.stringify(state, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

// ─── Signal Processor ────────────────────────────────────────────────────────

function processEnrichedSignal(signal: EnrichedSignal): void {
  updateSquadStatus('running');
  log(`=== Secretary processing enriched signal for: ${signal.filename} ===`);

  const { subject, body } = composeGreeting(signal);
  log(`Composing greeting | tone=${signal.vibeCheck.tone} | confidence=${signal.vibeCheck.confidence}%`);
  log(`Body: "${body}"`);

  const notification: Notification = {
    id:        uuid(),
    ts:        new Date().toISOString(),
    priority:  signal.vibeCheck.confidence >= 70 ? 'normal' : 'low',
    channel:   'in-app',
    recipient: 'user',
    subject,
    body,
    metadata:  {
      filename:      signal.filename,
      tone:          signal.vibeCheck.tone,
      confidence:    signal.vibeCheck.confidence,
      vibeLabel:     signal.vibeCheck.label,
      signalTs:      signal.ts,
      watchedRoot:   signal.watchedRoot,
    },
    retries:    0,
    maxRetries: 3,
  };

  enqueueNotification(notification);

  // ── Operation Voice: dispatch immediately via Windows notification
  log('Draining queue → Windows notification...');
  const drain = drainQueue(QUEUE_PATH, SENT_LOG, DEAD_LETTER_PATH);
  if (drain.dispatched > 0) {
    log(`Toast fired via [${drain.method}] — The Scholar has been informed.`);
  } else if (drain.failed > 0) {
    log('All dispatch channels failed — notification in dead-letter queue.', 'WARN');
  }

  updateSquadStatus('idle');
  log(`=== Secretary done. Notification dispatched. ===`);
}

// ─── Gilded Toast — Mission 5: The Dev Chronicle ─────────────────────────────

function dispatchChroniclerToast(signal: DraftsReadySignal): void {
  updateSquadStatus('running');
  log(`=== Secretary: Gilded Toast for commit ${signal.shortHash} ===`);

  const notification: Notification = {
    id:        uuid(),
    ts:        new Date().toISOString(),
    priority:  'high',
    channel:   'in-app',
    recipient: 'user',
    subject:   `The Chronicler — Commit ${signal.shortHash} drafted`,
    body:      `The Chronicler has prepared your build-in-public drafts for Commit ${signal.shortHash}: "${signal.subject}". Review at ${signal.draftsDir}/`,
    metadata:  {
      shortHash: signal.shortHash,
      subject:   signal.subject,
      draftsDir: signal.draftsDir,
      drafts:    signal.drafts,
    },
    retries:    0,
    maxRetries: 3,
  };

  const queue = readQueue();
  queue.push(notification);
  writeQueue(queue);
  log(`Gilded Toast enqueued | id=${notification.id}`);

  const drain = drainQueue(QUEUE_PATH, SENT_LOG, DEAD_LETTER_PATH);
  if (drain.dispatched > 0) {
    log(`Gilded Toast fired via [${drain.method}] — The Scholar has been briefed on ${signal.shortHash}.`);
  } else if (drain.failed > 0) {
    log('Gilded Toast dispatch failed — notification moved to dead-letter queue.', 'WARN');
  }

  updateSquadStatus('idle');
  log(`=== Secretary: Gilded Toast complete for ${signal.shortHash} ===`);
}

// ─── Wealth Action Plan Toast ─────────────────────────────────────────────────

function dispatchWealthActionPlanToast(signal: WealthActionPlanSignal): void {
  updateSquadStatus('running');
  log(`=== Secretary: Wealth Action Plan toast for ${signal.filename} ===`);

  const notification: Notification = {
    id:        uuid(),
    ts:        new Date().toISOString(),
    priority:  'high',
    channel:   'in-app',
    recipient: 'user',
    subject:   `Wealth Action Plan — ${signal.documentType}`,
    body:      `Aura scored "${signal.filename}" (${signal.relevanceScore}/100). ` +
               `${signal.actionCount} actions recommended. All processing was local. ` +
               `Review at ${signal.vaultPath}`,
    metadata:  {
      filename:  signal.filename,
      category:  signal.financialCategory,
      vaultPath: signal.vaultPath,
    },
    retries:    0,
    maxRetries: 3,
  };

  const queue = readQueue();
  queue.push(notification);
  writeQueue(queue);
  log(`Wealth Action Plan toast enqueued | id=${notification.id}`);

  const drain = drainQueue(QUEUE_PATH, SENT_LOG, DEAD_LETTER_PATH);
  if (drain.dispatched > 0) {
    log(`Wealth Action Plan toast fired via [${drain.method}] — The Scholar has been briefed.`);
  } else if (drain.failed > 0) {
    log('Wealth Action Plan toast dispatch failed — notification moved to dead-letter queue.', 'WARN');
  }

  updateSquadStatus('idle');
  log(`=== Secretary: Wealth Action Plan toast complete for ${signal.filename} ===`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  ensureDirs();
  updateSquadStatus('running');
  log('=== The Secretary is online. Watching for enriched signals + Chronicler drafts. ===');

  const watcher = createWatcher(
    {
      paths: [SIGNALS_DIR],
      ignoreInitial: true,
      recursive: false,
      awaitWriteFinishMs: 300,
    },
    (event) => {
      if (event.type === 'unlink') return;

      // ── Enriched signal from The Ethnographer (file acquisition alerts)
      if (event.filename === 'enriched_signal.json') {
        log(`Enriched signal detected. Preparing notification.`);
        try {
          const raw    = readFileSync(ENRICHED_SIG, 'utf-8');
          const signal = JSON.parse(raw) as EnrichedSignal;

          if (!signal.processed || !signal.vibeCheck) {
            log('Signal not fully enriched yet — waiting', 'WARN');
            return;
          }

          processEnrichedSignal(signal);
        } catch (err) {
          log(`Failed to process enriched signal: ${String(err)}`, 'ERROR');
          updateSquadStatus('error');
        }
        return;
      }

      // ── Drafts-ready signal from The Chronicler (Gilded Toast)
      if (event.filename === 'drafts-ready.json') {
        log(`Drafts-ready signal detected. Preparing Gilded Toast.`);
        try {
          const raw    = readFileSync(DRAFTS_READY_SIG, 'utf-8');
          const signal = JSON.parse(raw) as DraftsReadySignal;
          dispatchChroniclerToast(signal);
        } catch (err) {
          log(`Failed to process drafts-ready signal: ${String(err)}`, 'ERROR');
          updateSquadStatus('error');
        }
        return;
      }

      // ── Wealth Action Plan signal from The Financial Advisor
      if (event.filename === 'wealth-action-plan.json') {
        log(`Wealth Action Plan signal detected. Preparing toast.`);
        try {
          const raw    = readFileSync(WEALTH_ACTION_SIG, 'utf-8');
          const signal = JSON.parse(raw) as WealthActionPlanSignal;
          dispatchWealthActionPlanToast(signal);
        } catch (err) {
          log(`Failed to process wealth-action-plan signal: ${String(err)}`, 'ERROR');
          updateSquadStatus('error');
        }
        return;
      }
    },
  );

  updateSquadStatus('idle');
  log('Listening for Ethnographer enriched signals and Chronicler drafts-ready signals...');
  bindShutdown(watcher, 'secretary');
}

main();
