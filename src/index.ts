/**
 * Aura — Local Context Intelligence
 * Entry point
 *
 * Bootstraps the Squad, initializes state files, and hands off
 * to The General's coordination loop.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { SquadState } from './types/index.js';

const DATA_DIR = 'data';
const LOGS_DIR = join(DATA_DIR, 'logs');
const SQUAD_STATE_PATH = join(DATA_DIR, 'squad-state.json');
const NOTIFICATIONS_DIR = join(DATA_DIR, 'notifications');
const SIGNALS_DIR = join(DATA_DIR, 'signals');
const IDENTITY_DIR = join(DATA_DIR, 'identity');

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function ensureDirectories(): void {
  const dirs = [DATA_DIR, LOGS_DIR, NOTIFICATIONS_DIR, SIGNALS_DIR, IDENTITY_DIR];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      console.log(`[bootstrap] Created directory: ${dir}`);
    }
  }
}

function initSquadState(): SquadState {
  const initial: SquadState = {
    lastSync: new Date().toISOString(),
    commitCount: 0,
    agentStatus: {
      ethnographer:        'idle',
      librarian:           'idle',
      secretary:           'idle',
      chronicler:          'idle',
      strategist:          'idle',
      'financial-advisor': 'idle',
      monitor:             'idle',
    },
    pendingMissions: [],
    completedMissions: [],
    alerts: [],
  };

  if (!existsSync(SQUAD_STATE_PATH)) {
    writeFileSync(SQUAD_STATE_PATH, JSON.stringify(initial, null, 2));
    console.log('[bootstrap] Initialized squad-state.json');
    return initial;
  }

  const raw = readFileSync(SQUAD_STATE_PATH, 'utf-8');
  return JSON.parse(raw) as SquadState;
}

function initNotificationQueue(): void {
  const queuePath = join(NOTIFICATIONS_DIR, 'queue.json');
  if (!existsSync(queuePath)) {
    writeFileSync(queuePath, JSON.stringify([], null, 2));
    console.log('[bootstrap] Initialized notification queue');
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  console.log('');
  console.log('  ██████████████████████████████████████');
  console.log('  ██  AURA — Local Context Intelligence  ██');
  console.log('  ██  Squad: The General + 3 Agents       ██');
  console.log('  ██████████████████████████████████████');
  console.log('');

  ensureDirectories();
  const state = initSquadState();
  initNotificationQueue();

  console.log(`[The General] Squad online. Commit count: ${state.commitCount}/1000`);
  console.log(`[The General] Agent statuses:`);
  for (const [agent, status] of Object.entries(state.agentStatus)) {
    console.log(`  • ${agent}: ${status}`);
  }

  console.log('');
  console.log('[The General] Aura bootstrap complete. Ready for missions.');
  console.log('[The General] Run individual agents:');
  console.log('  npm run ethnographer');
  console.log('  npm run librarian');
  console.log('  npm run secretary');
  console.log('  npm run chronicler');
  console.log('');
  console.log('[The General] Mission 5: The Dev Chronicle — ACTIVE');
  console.log('  Commits → GitWatcher (Librarian) → Chronicler → Drafts → Gilded Toast (Secretary)');
}

main();
