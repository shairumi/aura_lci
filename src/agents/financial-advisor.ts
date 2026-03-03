/**
 * The Financial Advisor — Agent Entry Point
 * Demo Feature Set: Financial Intelligence Pipeline
 *
 * Watches data/signals/financial-file-signal.json (written by The Librarian).
 * For every new financial file signal:
 *   1. Reads the Financial Identity block from USER_IDENTITY.md
 *   2. Generates a Wealth Action Plan markdown document
 *   3. Saves it to agents/secretary/strategy-vault/finance/
 *   4. Emits WealthActionPlanSignal to data/signals/wealth-action-plan.json
 *      → triggers The Secretary's toast dispatch
 *
 * Privacy: reads only local files. No network calls. No external APIs.
 */

import { resolve, join, extname, basename } from 'path';
import {
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { homedir } from 'os';
import { createWatcher, bindShutdown } from '../services/watcher.js';
import { classifyFinancialFile, buildManualSignal, VALID_CATEGORIES } from '../utils/financial-detection.js';
import type { FinancialFileSignal, WealthActionPlanSignal, SquadState, FinancialCategory } from '../types/index.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT  = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const DATA_DIR      = join(PROJECT_ROOT, 'data');
const SIGNALS_DIR   = join(DATA_DIR, 'signals');
const LOGS_DIR      = join(DATA_DIR, 'logs');
const SQUAD_STATE   = join(DATA_DIR, 'squad-state.json');
const IDENTITY_PATH = join(PROJECT_ROOT, 'USER_IDENTITY.md');
const FINANCIAL_SIG = join(SIGNALS_DIR, 'financial-file-signal.json');
const WEALTH_SIG    = join(SIGNALS_DIR, 'wealth-action-plan.json');
const FINANCE_VAULT  = join(PROJECT_ROOT, 'agents', 'secretary', 'strategy-vault', 'finance');
const DOWNLOADS_DIR  = join(homedir(), 'Downloads');

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [DATA_DIR, SIGNALS_DIR, LOGS_DIR, FINANCE_VAULT]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
  const ts   = new Date().toISOString();
  const line = `[${ts}] [financial-advisor] [${level}] ${message}`;
  console.log(line);
  appendFileSync(join(LOGS_DIR, 'financial-advisor.log'), line + '\n', 'utf-8');
}

function updateSquadStatus(status: 'idle' | 'running' | 'error'): void {
  try {
    if (!existsSync(SQUAD_STATE)) return;
    const state = JSON.parse(readFileSync(SQUAD_STATE, 'utf-8')) as SquadState;
    (state.agentStatus as Record<string, string>)['financial-advisor'] = status;
    state.lastSync = new Date().toISOString();
    writeFileSync(SQUAD_STATE, JSON.stringify(state, null, 2), 'utf-8');
  } catch { /* non-fatal */ }
}

// ─── Financial Identity Reader ────────────────────────────────────────────────

interface FinancialIdentity {
  incomeBracket: string;
  savingsGoal: string;
  taxBracket: string;
  investmentProfile: string;
  alertThreshold: string;
  activeInstitutions: string;
  documentCadence: string;
  privacyLevel: string;
}

function readFinancialIdentity(): FinancialIdentity {
  const defaults: FinancialIdentity = {
    incomeBracket:      'Upper-middle (estimated)',
    savingsGoal:        'Emergency fund + passive income streams',
    taxBracket:         '22–24% federal (standard estimate)',
    investmentProfile:  'Growth-oriented, long-horizon',
    alertThreshold:     'Documents > $10K or any tax-relevant category',
    activeInstitutions: 'JPMorgan Chase, IRS, Brokerage (estimated)',
    documentCadence:    'Monthly statements, quarterly investment reviews',
    privacyLevel:       'Maximum — all processing local-only',
  };

  try {
    if (!existsSync(IDENTITY_PATH)) return defaults;
    const raw = readFileSync(IDENTITY_PATH, 'utf-8');

    const startIdx = raw.indexOf('<!-- FINANCIAL_IDENTITY_START -->');
    const endIdx   = raw.indexOf('<!-- FINANCIAL_IDENTITY_END -->');
    if (startIdx === -1 || endIdx === -1) return defaults;

    const block = raw.slice(startIdx, endIdx);

    // Parse table rows: | Field | Value |
    const rowRe = /\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/g;
    const result: Record<string, string> = {};
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(block)) !== null) {
      const key = (m[1] ?? '').trim();
      const val = (m[2] ?? '').trim();
      if (key && key !== 'Field' && val && val !== 'Value') {
        result[key] = val;
      }
    }

    return {
      incomeBracket:      result['Income Bracket']      ?? defaults.incomeBracket,
      savingsGoal:        result['Savings Goal']         ?? defaults.savingsGoal,
      taxBracket:         result['Tax Bracket']          ?? defaults.taxBracket,
      investmentProfile:  result['Investment Profile']   ?? defaults.investmentProfile,
      alertThreshold:     result['Alert Threshold']      ?? defaults.alertThreshold,
      activeInstitutions: result['Active Institutions']  ?? defaults.activeInstitutions,
      documentCadence:    result['Document Cadence']     ?? defaults.documentCadence,
      privacyLevel:       result['Privacy Level']        ?? defaults.privacyLevel,
    };
  } catch {
    return defaults;
  }
}

// ─── Action Plan Templates ────────────────────────────────────────────────────

const ACTIONS_BY_CATEGORY: Record<FinancialCategory, string[]> = {
  'bank-statement': [
    'Check that your balance is moving in the right direction — are you spending less than you earn?',
    'Look for any charges you don\'t recognise, especially anything recurring you didn\'t set up',
    'If a single transaction is over $500, decide whether it\'s tax-relevant and make a quick note',
    'Confirm there are no overdraft fees or unexpected bank charges buried in the statement',
    'Quick gut-check: does the spending here match how the month actually felt?',
  ],
  'tax-document': [
    'Check the income figure matches what you expected — surprises here are worth investigating',
    'Look for deductions you might have missed: home office, education, charitable giving, medical',
    'Find the filing deadline and any attachments the form calls for, and add a calendar reminder',
    'Store this somewhere you\'ll find it — keep tax documents for at least seven years',
    'Compare the key numbers to last year\'s version if you have it — big swings are a red flag',
  ],
  'investment': [
    'Check that your money is still spread across investments the way you intended',
    'Look at how things have performed this year — is the overall trend going in the right direction?',
    'Confirm dividends are being reinvested automatically if that\'s your preference',
    'Note any sales or distributions — these usually appear on your tax documents later',
    'If one investment has grown much larger than the rest, it may be time to rebalance',
  ],
  'payslip': [
    'Confirm the gross and net amounts match what you expected for this pay period',
    'Check that your tax withholding looks reasonable — if it\'s very high or very low, a W-4 update might help',
    'Make sure benefit deductions (health insurance, 401k) are still correct and haven\'t changed',
    'Note any bonuses, equity vesting, or one-off payments — these can affect your tax bill',
  ],
  'insurance': [
    'Think about what changed this past year — new job, new address, new family member, big purchase — your coverage may need updating',
    'Find the renewal date and set a calendar reminder 30 days before it so you\'re not rushed',
    'Check that the beneficiaries listed are still who you\'d want them to be',
    'If your premium went up significantly, it\'s worth getting a comparison quote before auto-renewing',
  ],
  'receipt': [
    'Check whether this is reimbursable — work expense, FSA, HSA — and submit it before the window closes',
    'Cross-check the amount against your bank or card statement to confirm it processed correctly',
    'File it somewhere you\'ll find it; receipts for big purchases are useful for warranties and returns',
  ],
  'other-financial': [
    'File it somewhere you\'ll find it when you need it',
    'Check whether it\'s reimbursable or tax-relevant before putting it away',
    'If it\'s from a company or institution you don\'t recognise, look it up before acting on anything in it',
  ],
};

// ─── Wealth Action Plan Generator ────────────────────────────────────────────

function categoryOpener(signal: FinancialFileSignal): string {
  const from = signal.institution ? ` from ${signal.institution}` : '';
  switch (signal.financialCategory) {
    case 'bank-statement':
      return `Your bank statement${from} landed in Downloads. Here are a few things worth checking while it's fresh.`;
    case 'tax-document':
      return `Looks like a tax document${from} is in your Downloads. Before it gets buried, here's what to look at.`;
    case 'investment':
      return `Your investment summary${from} is here. A few things to review while you have it open.`;
    case 'payslip':
      return `Your pay slip${from} just came in. Quick things to verify before you file it away.`;
    case 'insurance':
      return `Spotted an insurance document${from} in your Downloads. A few things that are easy to overlook.`;
    case 'receipt':
      return `Found a receipt or invoice${from} in your Downloads. A couple of things to take care of quickly.`;
    default:
      return `A financial document${from} landed in your Downloads. Here's what's worth doing with it.`;
  }
}

function keepInMind(signal: FinancialFileSignal, identity: FinancialIdentity): string {
  switch (signal.financialCategory) {
    case 'bank-statement':
      return [
        `Your goal is ${identity.savingsGoal} — this statement is a good moment to check whether your spending and saving are actually tracking toward that.`,
        `New recurring charges are easy to miss. If anything looks unfamiliar, cancel it now rather than later.`,
        `Bank statements are one of the most complete pictures of how your money actually moved. Worth a proper read once a quarter, not just a glance at the balance.`,
      ].join('\n\n');
    case 'tax-document':
      return [
        `Tax documents have a long shelf life — keep this one for at least seven years in case you're ever asked to verify your income.`,
        `If anything looks off compared to what you earned or paid, it's worth a quick call to whoever issued the document before you file.`,
        `This document likely affects what you can contribute to tax-advantaged accounts like an IRA or HSA — it's worth checking the limits for the year.`,
      ].join('\n\n');
    case 'investment':
      return [
        `Markets move, but your goal — ${identity.savingsGoal} — shouldn't change with them. Make sure short-term performance isn't quietly pulling your strategy off course.`,
        `If dividends are accumulating in cash rather than being reinvested, that's compounding you're leaving on the table.`,
        `Investment statements are worth reading properly once a quarter — not just checking the bottom line number.`,
      ].join('\n\n');
    case 'payslip':
      return [
        `Compare this to last month's pay slip before filing it. Even small discrepancies in deductions can add up over the year.`,
        `If your 401k contribution isn't close to the annual maximum and you have room in your budget, consider increasing it — the tax savings are immediate.`,
        `A small withholding mismatch now can mean a bigger bill or a delayed refund at tax time. Better to catch it early.`,
      ].join('\n\n');
    case 'insurance':
      return [
        `Insurance is easy to set and forget, but life changes — and your coverage should keep up. Even a quick five-minute read of the summary page is worth it.`,
        `The cheapest policy isn't always the best value. Check that the coverage limits are realistic for your current situation, not the situation you were in when you signed up.`,
        `Beneficiary details are the most overlooked part of any insurance document. Confirm they're current.`,
      ].join('\n\n');
    default:
      return [
        `File this somewhere you'll actually find it — financial documents have a way of disappearing exactly when you need them.`,
        `Check whether it's reimbursable through work, an FSA, or an HSA before the window closes.`,
      ].join('\n\n');
  }
}

function detectionFooter(signal: FinancialFileSignal): string {
  switch (signal.detectionMethod) {
    case 'content':
      return 'Aura identified this document by scanning the first page for standard financial phrases. The content was read locally and immediately discarded — nothing was stored or transmitted.';
    case 'manual':
      return `You manually classified this as a ${signal.documentType}. No content was read.`;
    default:
      return 'Aura identified this document by filename pattern. No content was read, and nothing left your device.';
  }
}

function generateWealthActionPlan(signal: FinancialFileSignal, identity: FinancialIdentity): string {
  const date    = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const actions = ACTIONS_BY_CATEGORY[signal.financialCategory];

  const numberedActions = actions
    .map((a, i) => `${i + 1}. ${a}`)
    .join('\n');

  return `# ${signal.documentType}

**${signal.filename}** · *${date}*

${categoryOpener(signal)}

---

## What to check

${numberedActions}

---

## Worth keeping in mind

${keepInMind(signal, identity)}

---

*${detectionFooter(signal)}*
`;
}

// ─── Vault Deduplication ──────────────────────────────────────────────────────

function vaultAlreadyHasPlan(filename: string): boolean {
  try {
    const prefix = filename.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20);
    return readdirSync(FINANCE_VAULT).some(f => f.startsWith(prefix));
  } catch {
    return false;
  }
}

// ─── Downloads Backfill Scan ──────────────────────────────────────────────────

async function scanExistingDownloads(): Promise<void> {
  log('=== Backfill scan: checking existing files in ~/Downloads ===');

  let files: string[];
  try {
    files = readdirSync(DOWNLOADS_DIR);
  } catch (err) {
    log(`Could not read Downloads directory: ${String(err)}`, 'WARN');
    return;
  }

  const IGNORED_EXTS = new Set(['.tmp', '.crdownload', '.part', '.download', '.partial']);
  const candidates   = files.filter(f => {
    if (f.startsWith('.') || f === 'desktop.ini' || f === 'Thumbs.db') return false;
    if (IGNORED_EXTS.has(extname(f).toLowerCase())) return false;
    return true;
  });

  let found = 0;
  let skipped = 0;

  for (const filename of candidates) {
    let sizeBytes: number | null = null;
    try { sizeBytes = statSync(join(DOWNLOADS_DIR, filename)).size; } catch { /* optional */ }

    const fullPath = join(DOWNLOADS_DIR, filename);
    const signal   = await classifyFinancialFile(filename, fullPath, sizeBytes);
    if (!signal) continue;

    found++;

    if (vaultAlreadyHasPlan(filename)) {
      log(`Backfill: skipping "${filename}" — plan already exists in vault`);
      skipped++;
      continue;
    }

    log(`Backfill [${signal.detectionMethod}]: "${filename}" → ${signal.documentType} (${signal.relevanceScore}/100)`);
    generatePlan(signal);
  }

  if (found === 0) {
    log('Backfill scan: no financial documents found in ~/Downloads');
  } else {
    log(`Backfill scan complete: ${found} financial file(s) found, ${skipped} already in vault, ${found - skipped} processed`);
  }
}

// ─── Core Orchestration ───────────────────────────────────────────────────────

function generatePlan(signal: FinancialFileSignal): void {
  updateSquadStatus('running');
  log(`=== Financial Advisor: scoring ${signal.filename} ===`);
  log(`Category: ${signal.financialCategory} | Score: ${signal.relevanceScore}/100 | Institution: ${signal.institution ?? 'unknown'}`);

  const identity = readFinancialIdentity();
  log('Financial Identity read from USER_IDENTITY.md');

  const plan = generateWealthActionPlan(signal, identity);

  // Build a safe short ID for the filename
  const safeName = signal.filename.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 20);
  const shortId  = `${safeName}-${Date.now().toString(36)}`;
  const planFile = `${shortId}-wealth-action-plan.md`;
  const planPath = join(FINANCE_VAULT, planFile);
  const relPath  = `agents/secretary/strategy-vault/finance/${planFile}`;

  writeFileSync(planPath, plan, 'utf-8');
  log(`Wealth Action Plan written → ${relPath}`);

  const actions = ACTIONS_BY_CATEGORY[signal.financialCategory];

  const wealthSignal: WealthActionPlanSignal = {
    ts:                new Date().toISOString(),
    agent:             'financial-advisor',
    filename:          signal.filename,
    financialCategory: signal.financialCategory,
    documentType:      signal.documentType,
    institution:       signal.institution,
    relevanceScore:    signal.relevanceScore,
    vaultPath:         relPath,
    actionCount:       actions.length,
  };

  writeFileSync(WEALTH_SIG, JSON.stringify(wealthSignal, null, 2), 'utf-8');
  log(`WealthActionPlanSignal written → data/signals/wealth-action-plan.json`);

  updateSquadStatus('idle');
  log(`=== Financial Advisor: mission complete. Secretary notified. ===`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureDirs();
  updateSquadStatus('running');
  log('=== The Financial Advisor is online. ===');
  log(`Finance vault: agents/secretary/strategy-vault/finance/`);

  // ── Backfill: process financial docs already in Downloads before live-watching
  await scanExistingDownloads();

  // ── Watcher 1: ~/Downloads — primary live detection (self-contained, no Librarian needed)
  const downloadsWatcher = createWatcher(
    {
      paths:              [DOWNLOADS_DIR],
      ignoreInitial:      true,
      recursive:          false,
      awaitWriteFinishMs: 2000, // wait for download to fully complete
    },
    async (event) => {
      if (event.type === 'unlink') return;

      const { filename, fullPath } = event;
      if (filename.startsWith('.') || filename === 'desktop.ini') return;

      const IGNORED_EXTS = new Set(['.tmp', '.crdownload', '.part', '.download', '.partial']);
      if (IGNORED_EXTS.has(extname(filename).toLowerCase())) return;

      log(`Downloads event: ${filename}`);

      let sizeBytes: number | null = null;
      try { sizeBytes = statSync(fullPath).size; } catch { /* optional */ }

      const signal = await classifyFinancialFile(filename, fullPath, sizeBytes);
      if (!signal) {
        log(`Not a financial document: ${filename}`);
        return;
      }

      if (vaultAlreadyHasPlan(filename)) {
        log(`Plan already exists for "${filename}" — skipping`);
        return;
      }

      log(`Live detection [${signal.detectionMethod}]: "${filename}" → ${signal.documentType} (${signal.relevanceScore}/100)`);
      generatePlan(signal);
    },
  );

  // ── Watcher 2: data/signals/ — also responds to signals from the Librarian when it's running
  const signalsWatcher = createWatcher(
    {
      paths:              [SIGNALS_DIR],
      ignoreInitial:      true,
      recursive:          false,
      awaitWriteFinishMs: 300,
    },
    (event) => {
      if (event.filename !== 'financial-file-signal.json') return;
      if (event.type === 'unlink') return;

      log('Librarian financial signal received.');

      try {
        const raw    = readFileSync(FINANCIAL_SIG, 'utf-8');
        const signal = JSON.parse(raw) as FinancialFileSignal;

        if (vaultAlreadyHasPlan(signal.filename)) {
          log(`Plan already exists for "${signal.filename}" (likely processed by Downloads watcher) — skipping`);
          return;
        }

        generatePlan(signal);
      } catch (err) {
        log(`Failed to process Librarian signal: ${String(err)}`, 'ERROR');
        updateSquadStatus('error');
      }
    },
  );

  updateSquadStatus('idle');
  log(`Watching ~/Downloads directly for new financial documents`);
  log(`Also listening for Librarian signals in data/signals/`);

  process.on('SIGINT',  () => {
    downloadsWatcher.close().catch(() => undefined);
    signalsWatcher.close().catch(() => undefined);
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    downloadsWatcher.close().catch(() => undefined);
    signalsWatcher.close().catch(() => undefined);
    process.exit(0);
  });
}

// ─── Entry Point ──────────────────────────────────────────────────────────────
// Normal mode:   node financial-advisor.js
// Manual classify: node financial-advisor.js --classify "Cornell.pdf" [--category tax-document]

const classifyIdx = process.argv.indexOf('--classify');

if (classifyIdx !== -1) {
  (async () => {
    const raw = process.argv[classifyIdx + 1];
    if (!raw) {
      console.error('Usage: --classify <filename-or-path> [--category <category>]');
      console.error('Categories:', VALID_CATEGORIES.join(', '));
      process.exit(1);
    }

    // Accept either a bare filename (looked up in Downloads) or a full path
    const isPath   = raw.includes('/') || raw.includes('\\');
    const fullPath = isPath ? raw : join(DOWNLOADS_DIR, raw);
    const filename = basename(fullPath);

    const catIdx  = process.argv.indexOf('--category');
    const rawCat  = catIdx !== -1 ? process.argv[catIdx + 1] : undefined;
    const manualCat = VALID_CATEGORIES.includes(rawCat as FinancialCategory)
      ? (rawCat as FinancialCategory)
      : undefined;

    ensureDirs();
    updateSquadStatus('running');
    log(`=== Financial Advisor: --classify "${filename}" ===`);

    // Try content scan + filename first; fall back to manual category
    let signal = await classifyFinancialFile(filename, fullPath, null);

    if (!signal) {
      const category = manualCat ?? 'other-financial';
      log(`Auto-detection found nothing — using ${manualCat ? `supplied category "${category}"` : `default "other-financial"`}`);
      signal = buildManualSignal(filename, category);
    } else if (signal.detectionMethod !== 'manual') {
      log(`Auto-detected as ${signal.documentType} via ${signal.detectionMethod}${manualCat && manualCat !== signal.financialCategory ? ` (overriding with supplied --category "${manualCat}")` : ''}`);
      // Honour explicit --category override if supplied
      if (manualCat && manualCat !== signal.financialCategory) {
        signal = buildManualSignal(filename, manualCat, signal.sizeBytes);
      }
    }

    generatePlan(signal);
    updateSquadStatus('idle');
  })().catch(err => { console.error(err); process.exit(1); });
} else {
  main().catch(err => { console.error(err); process.exit(1); });
}
