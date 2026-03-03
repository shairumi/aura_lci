/**
 * The Monitor — Live Terminal Dashboard
 * Demo Feature Set: Financial Intelligence Pipeline
 *
 * Polls every 2 seconds and redraws a terminal panel showing:
 *   - Agent squad statuses (from data/squad-state.json)
 *   - Signal feed (last 8 entries from data/logs/*.log)
 *   - Latest Wealth Action Plan (from agents/secretary/strategy-vault/finance/)
 *   - Wi-Fi connectivity indicator (probes 8.8.8.8:53)
 *
 * Privacy: reads only local files and makes one local TCP probe. No data
 * leaves the device. The network probe is connectivity detection only.
 */

import { resolve, join, basename } from 'path';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'fs';
import net from 'net';
import type { SquadState, AgentName } from '../types/index.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT  = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const DATA_DIR      = join(PROJECT_ROOT, 'data');
const LOGS_DIR      = join(DATA_DIR, 'logs');
const SQUAD_STATE   = join(DATA_DIR, 'squad-state.json');
const FINANCE_VAULT = join(PROJECT_ROOT, 'agents', 'secretary', 'strategy-vault', 'finance');

// ─── ANSI Helpers ─────────────────────────────────────────────────────────────

const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
};

const W = 50; // panel inner width (between ║ chars)

function pad(s: string, width: number): string {
  // Strip ANSI codes for length calculation
  const plain = s.replace(/\x1b\[[0-9;]*m/g, '');
  const spaces = width - plain.length;
  return s + (spaces > 0 ? ' '.repeat(spaces) : '');
}

function row(content: string): string {
  return `║ ${pad(content, W - 2)} ║`;
}

function divider(): string {
  return `╠${'═'.repeat(W)}╣`;
}

// ─── Wi-Fi Probe ──────────────────────────────────────────────────────────────

function checkConnectivity(): Promise<boolean> {
  return new Promise(resolve => {
    const s = net.createConnection({ host: '8.8.8.8', port: 53 });
    s.setTimeout(500);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error',   () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

// ─── Squad State Reader ───────────────────────────────────────────────────────

const DISPLAY_AGENTS: AgentName[] = [
  'librarian', 'financial-advisor', 'ethnographer', 'secretary', 'chronicler',
];

function readSquadState(): Record<string, string> {
  try {
    if (!existsSync(SQUAD_STATE)) return {};
    const raw   = readFileSync(SQUAD_STATE, 'utf-8');
    const state = JSON.parse(raw) as SquadState;
    return state.agentStatus as unknown as Record<string, string>;
  } catch {
    return {};
  }
}

// ─── Log Feed Reader ──────────────────────────────────────────────────────────

interface FeedLine {
  ts: string;
  agent: string;
  message: string;
}

const AGENT_ICONS: Record<string, string> = {
  librarian:          '📁',
  ethnographer:       '🔍',
  'financial-advisor':'📊',
  chronicler:         '✍️',
  strategist:         '🧠',
  secretary:          '🔔',
  monitor:            '🖥️',
};

function readLogFeed(maxLines = 8): FeedLine[] {
  const lines: FeedLine[] = [];

  let logFiles: string[] = [];
  try {
    logFiles = readdirSync(LOGS_DIR)
      .filter(f => f.endsWith('.log'))
      .map(f => join(LOGS_DIR, f));
  } catch { return []; }

  for (const logPath of logFiles) {
    const agentName = basename(logPath, '.log');
    try {
      const content = readFileSync(logPath, 'utf-8');
      const rawLines = content.split('\n').filter(Boolean);
      // Take last 20 lines per log; we'll sort and slice across all
      for (const line of rawLines.slice(-20)) {
        // Format: [ISO_TS] [agent] [LEVEL] message
        const m = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$/);
        if (m) {
          lines.push({ ts: m[1] ?? '', agent: agentName, message: m[4] ?? '' });
        }
      }
    } catch { /* skip */ }
  }

  lines.sort((a, b) => a.ts.localeCompare(b.ts));
  return lines.slice(-maxLines);
}

// ─── Finance Vault Reader ─────────────────────────────────────────────────────

interface LatestPlan {
  filename: string;
  actionCount: number;
}

function readLatestWealthPlan(): LatestPlan | null {
  try {
    if (!existsSync(FINANCE_VAULT)) return null;
    const files = readdirSync(FINANCE_VAULT)
      .filter(f => f.endsWith('.md'))
      .map(f => ({ name: f, mtime: statSync(join(FINANCE_VAULT, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) return null;

    const latest = files[0]!;
    // Count action items (lines starting with a digit + .)
    const content    = readFileSync(join(FINANCE_VAULT, latest.name), 'utf-8');
    const actionCount = (content.match(/^\d+\./gm) ?? []).length;

    return { filename: latest.name.replace('-wealth-action-plan.md', ''), actionCount };
  } catch {
    return null;
  }
}

// ─── Status Dot ───────────────────────────────────────────────────────────────

function statusDot(status: string | undefined): string {
  if (status === 'running') return `${C.green}●${C.reset}`;
  if (status === 'error')   return `${C.red}●${C.reset}`;
  return `${C.yellow}●${C.reset}`;
}

function statusLabel(status: string | undefined): string {
  const s = status ?? 'idle';
  if (s === 'running') return `${C.green}[running]${C.reset}`;
  if (s === 'error')   return `${C.red}[error  ]${C.reset}`;
  return `${C.dim}[idle   ]${C.reset}`;
}

// ─── Panel Renderer ───────────────────────────────────────────────────────────

async function render(): Promise<void> {
  const [wifi, statuses, feed, plan] = await Promise.all([
    checkConnectivity(),
    Promise.resolve(readSquadState()),
    Promise.resolve(readLogFeed(8)),
    Promise.resolve(readLatestWealthPlan()),
  ]);

  const wifiLine = wifi
    ? `${C.green}🔒 Wi-Fi: ON${C.reset}  │  All processing: LOCAL`
    : `${C.yellow}🔓 Wi-Fi: OFF${C.reset} │  All processing: LOCAL ${C.green}✅${C.reset}`;

  const lines: string[] = [];

  lines.push(`╔${'═'.repeat(W)}╗`);
  lines.push(row(`${C.bold}${C.cyan}     AURA MONITOR — Local Context AI${C.reset}`));
  lines.push(row(wifiLine));
  lines.push(divider());
  lines.push(row(`${C.bold}AGENT SQUAD${C.reset}`));

  for (const agent of DISPLAY_AGENTS) {
    const st  = statuses[agent];
    const dot = statusDot(st);
    const lbl = statusLabel(st);
    const nameCol = agent.padEnd(20);
    lines.push(row(`  ${dot} ${C.white}${nameCol}${C.reset} ${lbl}`));
  }

  lines.push(divider());
  lines.push(row(`${C.bold}SIGNAL FEED${C.reset}` + `${C.dim}                        (last 8)${C.reset}`));

  if (feed.length === 0) {
    lines.push(row(`  ${C.dim}No signals yet — waiting...${C.reset}`));
  } else {
    for (const entry of feed) {
      const icon    = AGENT_ICONS[entry.agent] ?? '▸';
      const timeStr = entry.ts.slice(11, 19); // HH:MM:SS
      const agentShort = entry.agent.slice(0, 9).padEnd(9);
      const maxMsg  = W - 2 - 1 - 8 - 1 - 10 - 1 - 3; // leave room for icon+padding
      const msg     = entry.message.replace(/^[=]+\s*/, '').slice(0, maxMsg);
      lines.push(row(`  ${C.dim}${timeStr}${C.reset}  ${icon} ${C.cyan}${agentShort}${C.reset}  ${msg}`));
    }
  }

  lines.push(divider());
  lines.push(row(`${C.bold}LAST WEALTH ACTION PLAN${C.reset}`));

  if (!plan) {
    lines.push(row(`  ${C.dim}None yet — drop a financial PDF in ~/Downloads${C.reset}`));
  } else {
    const truncName = plan.filename.slice(0, W - 6);
    lines.push(row(`  ${C.green}${truncName}${C.reset}`));
    lines.push(row(`  ${C.dim}strategy-vault/finance/ · ${plan.actionCount} actions${C.reset}`));
  }

  lines.push(divider());
  lines.push(row(`  ${C.dim}Press Ctrl+C to exit${C.reset}`));
  lines.push(`╚${'═'.repeat(W)}╝`);

  // Clear screen and redraw
  process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write(lines.join('\n') + '\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  process.stdout.write('\x1b[?25l'); // hide cursor
  process.on('SIGINT',  () => { process.stdout.write('\x1b[?25h\n'); process.exit(0); });
  process.on('SIGTERM', () => { process.stdout.write('\x1b[?25h\n'); process.exit(0); });

  await render();
  setInterval(() => { render().catch(console.error); }, 2000);
}

main().catch(console.error);
