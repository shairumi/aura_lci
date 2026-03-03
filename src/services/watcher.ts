/**
 * Aura — Watcher Service
 * Reusable chokidar wrapper used by all file-watching agents.
 *
 * Privacy guarantee: full file paths are resolved internally but only
 * basenames are passed to callers via FileEvent.path.
 */

import { watch, type FSWatcher } from 'chokidar';
import { homedir } from 'os';
import { resolve, join, basename } from 'path';
import { existsSync } from 'fs';

export interface WatcherConfig {
  /** Paths to watch. Supports leading ~ for home directory. */
  paths: string[];
  /** Glob patterns or paths to ignore. */
  ignored?: string | RegExp | Array<string | RegExp>;
  /** Skip initial 'add' events for existing files. Default: true. */
  ignoreInitial?: boolean;
  /** Watch subdirectories. Default: false (top-level only). */
  recursive?: boolean;
  /**
   * Wait for file write to stabilise before emitting.
   * Essential for large downloads. Default: 1500ms.
   */
  awaitWriteFinishMs?: number | false;
}

export interface FileEvent {
  /** Event type */
  type: 'add' | 'change' | 'unlink';
  /** Basename only — never a full path */
  filename: string;
  /** Full resolved path — for internal use by the calling agent */
  fullPath: string;
  /** Resolved watched root this file belongs to */
  watchedRoot: string;
}

export type FileEventCallback = (event: FileEvent) => void | Promise<void>;

/**
 * Resolve a potentially ~ path to absolute.
 */
function resolvePath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1));
  }
  return resolve(p);
}

/**
 * Create a chokidar watcher and bind a unified event callback.
 * Returns the FSWatcher for lifecycle management (close on SIGINT, etc.).
 */
export function createWatcher(
  config: WatcherConfig,
  onEvent: FileEventCallback,
): FSWatcher {
  const resolvedPaths = config.paths
    .map(resolvePath)
    .filter((p) => {
      if (!existsSync(p)) {
        console.warn(`[watcher] Path does not exist, skipping: ${p}`);
        return false;
      }
      return true;
    });

  if (resolvedPaths.length === 0) {
    throw new Error('[watcher] No valid watch paths found. Check config/watcher.json.');
  }

  const depth = config.recursive === true ? undefined : 0;

  const awaitWriteFinish =
    config.awaitWriteFinishMs === false
      ? false
      : {
          stabilityThreshold: config.awaitWriteFinishMs ?? 1500,
          pollInterval: 100,
        };

  const watcher = watch(resolvedPaths, {
    persistent: true,
    ignoreInitial: config.ignoreInitial ?? true,
    followSymlinks: false,
    awaitWriteFinish,
    ...(depth !== undefined ? { depth } : {}),
    ...(config.ignored !== undefined ? { ignored: config.ignored } : {}),
  });

  const makeHandler =
    (type: 'add' | 'change' | 'unlink') =>
    (fullPath: string): void => {
      // Determine which watched root this path belongs to
      const watchedRoot =
        resolvedPaths.find((root) => fullPath.startsWith(root)) ?? resolvedPaths[0] ?? fullPath;

      const event: FileEvent = {
        type,
        filename: basename(fullPath),
        fullPath,
        watchedRoot,
      };

      void Promise.resolve(onEvent(event)).catch((err: unknown) => {
        console.error(`[watcher] Callback error on ${type} event:`, err);
      });
    };

  watcher
    .on('add', makeHandler('add'))
    .on('change', makeHandler('change'))
    .on('unlink', makeHandler('unlink'))
    .on('error', (err) => console.error('[watcher] FSWatcher error:', err));

  return watcher;
}

/**
 * Gracefully shut down a watcher on process exit signals.
 */
export function bindShutdown(watcher: FSWatcher, agentName: string): void {
  const shutdown = (): void => {
    console.log(`\n[${agentName}] SIGINT received — closing watcher.`);
    watcher.close().then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
