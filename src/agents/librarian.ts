/**
 * The Librarian — Agent Entry Point
 * Operation Watchtower
 *
 * Watches ~/Downloads and the project data/ directory.
 * On new file in Downloads: writes a FileSignal to data/signals/new_file.json
 * and appends to data/signals/librarian-events.jsonl.
 *
 * Privacy: only basenames and metadata are recorded. Contents never read.
 */

import { homedir } from 'os';
import { join, extname, resolve } from 'path';
import {
  writeFileSync,
  appendFileSync,
  statSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'fs';
import { execSync } from 'child_process';
import { createWatcher, bindShutdown } from '../services/watcher.js';
import { classifyFinancialFile } from '../utils/financial-detection.js';
import type { FileSignal, GitCommitSignal, DiffStats, SquadState } from '../types/index.js';

// ─── Paths ────────────────────────────────────────────────────────────────────

const PROJECT_ROOT   = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const DATA_DIR       = join(PROJECT_ROOT, 'data');
const SIGNALS_DIR    = join(DATA_DIR, 'signals');
const LOGS_DIR       = join(DATA_DIR, 'logs');
const EVENTS_LOG     = join(SIGNALS_DIR, 'librarian-events.jsonl');
const NEW_FILE_SIG    = join(SIGNALS_DIR, 'new_file.json');
const GIT_COMMIT_SIG  = join(SIGNALS_DIR, 'git-commit-signal.json');
const FINANCIAL_SIG   = join(SIGNALS_DIR, 'financial-file-signal.json');
const SQUAD_STATE    = join(DATA_DIR, 'squad-state.json');
const DOWNLOADS_DIR  = join(homedir(), 'Downloads');
const WATCHER_CONF   = join(PROJECT_ROOT, 'config', 'watcher.json');
const GIT_DIR        = join(PROJECT_ROOT, '.git');

// Files to ignore in Downloads (temp/in-progress downloads)
const IGNORED_EXTS = new Set(['.tmp', '.crdownload', '.part', '.download', '.partial']);

// ─── Utilities ────────────────────────────────────────────────────────────────

function ensureDirs(): void {
  for (const dir of [DATA_DIR, SIGNALS_DIR, LOGS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function log(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO'): void {
  const ts  = new Date().toISOString();
  const line = `[${ts}] [librarian] [${level}] ${message}`;
  console.log(line);
  appendFileSync(join(LOGS_DIR, 'librarian.log'), line + '\n', 'utf-8');
}

function updateSquadStatus(status: 'idle' | 'running' | 'error'): void {
  try {
    if (!existsSync(SQUAD_STATE)) return;
    const state = JSON.parse(readFileSync(SQUAD_STATE, 'utf-8')) as SquadState;
    state.agentStatus.librarian = status;
    state.lastSync = new Date().toISOString();
    writeFileSync(SQUAD_STATE, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // non-fatal — squad state update is best-effort
  }
}

function getFileMeta(fullPath: string): { sizeBytes: number | null; mtimeMs: number | null } {
  try {
    const stat = statSync(fullPath);
    return { sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return { sizeBytes: null, mtimeMs: null };
  }
}

// ─── Core Signal Writer ───────────────────────────────────────────────────────

function writeSignal(signal: FileSignal): void {
  // Overwrite latest signal (triggers Ethnographer watcher)
  writeFileSync(NEW_FILE_SIG, JSON.stringify(signal, null, 2), 'utf-8');
  log(`Signal written → data/signals/new_file.json | file=${signal.filename}`);

  // Append to historical event log
  appendFileSync(EVENTS_LOG, JSON.stringify(signal) + '\n', 'utf-8');
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

function shouldIgnore(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  if (IGNORED_EXTS.has(ext)) return true;
  if (filename.startsWith('.')) return true;           // hidden files
  if (filename === 'desktop.ini') return true;
  if (filename === 'Thumbs.db') return true;
  return false;
}

async function onDownloadsEvent(type: 'add' | 'change' | 'unlink', filename: string, fullPath: string): Promise<void> {
  if (shouldIgnore(filename)) {
    log(`Ignoring temp/hidden file: ${filename}`);
    return;
  }

  const ext  = extname(filename).toLowerCase() || null;
  const meta = getFileMeta(fullPath);

  const signal: FileSignal = {
    ts:          new Date().toISOString(),
    agent:       'librarian',
    event:       type,
    watchedRoot: 'downloads',
    filename,
    ext,
    sizeBytes:   meta.sizeBytes,
    mtimeMs:     meta.mtimeMs,
    processed:   false,
  };

  log(`Downloads event | type=${type} | file=${filename} | ext=${ext ?? 'none'} | size=${meta.sizeBytes ?? '?'}B`);
  writeSignal(signal);

  // ── Financial file detection (content scan → filename fallback)
  if (type === 'add' || type === 'change') {
    const fin = await classifyFinancialFile(filename, fullPath, meta.sizeBytes);
    if (fin) {
      writeFileSync(FINANCIAL_SIG, JSON.stringify(fin, null, 2), 'utf-8');
      log(`Financial signal [${fin.detectionMethod}]: ${fin.documentType} (${fin.relevanceScore}/100) → financial-file-signal.json`);
    }
  }
}

function onDataEvent(type: 'add' | 'change' | 'unlink', filename: string): void {
  // Only log — data/ changes are internal Squad activity, not user signals
  log(`Project data/ event | type=${type} | file=${filename}`);
  appendFileSync(EVENTS_LOG, JSON.stringify({
    ts: new Date().toISOString(),
    agent: 'librarian',
    event: type,
    watchedRoot: 'project-data',
    filename,
    ext: extname(filename).toLowerCase() || null,
    sizeBytes: null,
    mtimeMs: null,
    processed: true, // internal — skip Ethnographer pipeline
  }) + '\n', 'utf-8');
}

// ─── GitWatcher — Mission 5: The Dev Chronicle ───────────────────────────────

function parseDiffStats(statOutput: string): DiffStats {
  const lines        = statOutput.trim().split('\n');
  const changedFiles: string[] = [];
  let filesChanged   = 0;
  let insertions     = 0;
  let deletions      = 0;

  for (const line of lines) {
    // File lines look like:  " src/agents/lib.ts | 52 +++---"
    const fileMatch = line.match(/^\s+(.+?)\s+\|/);
    if (fileMatch) {
      changedFiles.push((fileMatch[1] ?? '').trim());
      continue;
    }
    // Summary: "2 files changed, 40 insertions(+), 3 deletions(-)"
    const summaryMatch = line.match(
      /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/,
    );
    if (summaryMatch) {
      filesChanged = parseInt(summaryMatch[1] ?? '0', 10);
      insertions   = parseInt(summaryMatch[2] ?? '0', 10);
      deletions    = parseInt(summaryMatch[3] ?? '0', 10);
    }
  }

  return { filesChanged, insertions, deletions, changedFiles };
}

function extractCommitData(): GitCommitSignal | null {
  try {
    const logRaw = execSync(
      'git log -1 --format=HASH:%H%nSHORT:%h%nSUBJECT:%s%nAUTHOR:%an%nEMAIL:%ae%nDATE:%aI',
      { cwd: PROJECT_ROOT, encoding: 'utf-8' },
    ).trim();

    const hashMatch    = logRaw.match(/HASH:(.+)/);
    const shortMatch   = logRaw.match(/SHORT:(.+)/);
    const subjectMatch = logRaw.match(/SUBJECT:(.+)/);
    const authorMatch  = logRaw.match(/AUTHOR:(.+)/);
    const emailMatch   = logRaw.match(/EMAIL:(.+)/);
    const dateMatch    = logRaw.match(/DATE:(.+)/);

    if (!hashMatch || !shortMatch || !subjectMatch) {
      log('Could not parse git log output', 'ERROR');
      return null;
    }

    const body   = execSync('git log -1 --format=%b', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim();
    const branch = execSync('git branch --show-current', { cwd: PROJECT_ROOT, encoding: 'utf-8' }).trim();

    // diff-tree works for all commits with parents; fall back to git show --stat for initial commit
    let statOutput = '';
    try {
      statOutput = execSync('git diff-tree --no-commit-id -r --stat HEAD', { cwd: PROJECT_ROOT, encoding: 'utf-8' });
    } catch {
      statOutput = execSync('git show --stat HEAD', { cwd: PROJECT_ROOT, encoding: 'utf-8' });
    }
    const diffStats = parseDiffStats(statOutput);

    // Full diff via git show (truncated at 500 lines to avoid huge payloads)
    const MAX_DIFF_LINES = 500;
    const rawDiff  = execSync('git show HEAD', { cwd: PROJECT_ROOT, encoding: 'utf-8' });
    const diffLines = rawDiff.split('\n');
    const diff = diffLines.length > MAX_DIFF_LINES
      ? diffLines.slice(0, MAX_DIFF_LINES).join('\n') + '\n... [diff truncated at 500 lines]'
      : rawDiff;

    return {
      ts:              new Date().toISOString(),
      agent:           'librarian',
      commitHash:      (hashMatch[1] ?? '').trim(),
      shortHash:       (shortMatch[1] ?? '').trim(),
      subject:         (subjectMatch[1] ?? '').trim(),
      body,
      author:          (authorMatch?.[1] ?? 'Unknown').trim(),
      authorEmail:     (emailMatch?.[1] ?? '').trim(),
      commitTimestamp: (dateMatch?.[1] ?? new Date().toISOString()).trim(),
      branch,
      diff,
      diffStats,
    };
  } catch (err) {
    log(`extractCommitData error: ${String(err)}`, 'ERROR');
    return null;
  }
}

function startGitWatcher(): void {
  if (!existsSync(GIT_DIR)) {
    log('No .git directory found — GitWatcher disabled', 'WARN');
    return;
  }

  // Watch .git/ top-level; filter for COMMIT_EDITMSG to detect new commits
  const gitWatcher = createWatcher(
    {
      paths:             [GIT_DIR],
      ignoreInitial:     true,
      recursive:         false,
      awaitWriteFinishMs: 300,
    },
    (event) => {
      if (event.filename !== 'COMMIT_EDITMSG') return;
      if (event.type === 'unlink') return;

      log('=== GitWatcher: commit detected. Extracting data... ===');
      const signal = extractCommitData();
      if (!signal) return;

      writeFileSync(GIT_COMMIT_SIG, JSON.stringify(signal, null, 2), 'utf-8');
      log(`Git commit signal written → data/signals/git-commit-signal.json | ${signal.shortHash} "${signal.subject}"`);

      appendFileSync(EVENTS_LOG, JSON.stringify({
        ts:          signal.ts,
        agent:       'librarian',
        event:       'commit',
        watchedRoot: 'git',
        filename:    'COMMIT_EDITMSG',
        ext:         null,
        sizeBytes:   null,
        mtimeMs:     null,
        processed:   false,
      }) + '\n', 'utf-8');
    },
  );

  log(`GitWatcher active: monitoring .git/ for COMMIT_EDITMSG`);
  process.on('SIGINT',  () => { gitWatcher.close().catch(() => undefined); });
  process.on('SIGTERM', () => { gitWatcher.close().catch(() => undefined); });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  ensureDirs();
  updateSquadStatus('running');
  log('=== The Librarian is online. Operation Watchtower + Dev Chronicle active. ===');
  log(`Watching Downloads: ${DOWNLOADS_DIR}`);
  log(`Watching project data/: ${DATA_DIR}`);
  log(`Watching git commits: ${GIT_DIR}/COMMIT_EDITMSG`);

  // ── Watcher 1: ~/Downloads (file signals → pipeline)
  const downloadsWatcher = createWatcher(
    {
      paths: [DOWNLOADS_DIR],
      ignoreInitial: true,
      recursive: false,
      awaitWriteFinishMs: 2000, // wait for download to complete
    },
    (event) => {
      if (event.type === 'add' || event.type === 'change') {
        onDownloadsEvent(event.type, event.filename, event.fullPath);
      } else if (event.type === 'unlink') {
        log(`File removed from Downloads: ${event.filename}`, 'WARN');
      }
    },
  );

  // ── Watcher 2: project data/ (activity logging only, not signal pipeline)
  const dataWatcher = createWatcher(
    {
      paths: [DATA_DIR],
      ignoreInitial: true,
      recursive: false,
      awaitWriteFinishMs: false,
      // Ignore signal files that the Librarian itself writes — prevents feedback loop
      ignored: [NEW_FILE_SIG, EVENTS_LOG],
    },
    (event) => {
      // Only log sub-dir changes, not the signals we write ourselves
      if (!event.filename.startsWith('new_file') && !event.filename.startsWith('librarian')) {
        onDataEvent(event.type, event.filename);
      }
    },
  );

  // ── Watcher 3: .git/COMMIT_EDITMSG (commit detection → Dev Chronicle pipeline)
  startGitWatcher();

  updateSquadStatus('idle');
  log('All watchers initialised. Listening...');

  bindShutdown(downloadsWatcher, 'librarian');
  // Also close data watcher on exit
  process.on('SIGINT', () => { dataWatcher.close().catch(() => undefined); });
  process.on('SIGTERM', () => { dataWatcher.close().catch(() => undefined); });
}

main();
