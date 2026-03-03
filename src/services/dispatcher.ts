/**
 * Dispatcher Service — Operation Gilded Voice
 * Drains data/notifications/queue.json and fires Windows notifications.
 *
 * Dispatch chain (first success wins):
 *   1. BurntToast  — rich Windows 10/11 toast with Aura logo + Reminder chime
 *   2. Balloon tip — System.Windows.Forms NotifyIcon (always-available fallback)
 *
 * The notification body is passed verbatim — tone is owned by The Secretary.
 * The Dispatcher is a delivery pipe only; it never rewrites content.
 *
 * Privacy guarantee: all dispatch is local. No network calls.
 */

import { spawnSync } from 'child_process';
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  renameSync,
} from 'fs';
import { join, resolve } from 'path';
import type { Notification, SentReceipt, DeadLetterEntry } from '../types/index.js';

// ─── Asset Paths ──────────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const LOGO_PATH    = join(PROJECT_ROOT, 'assets', 'aura-logo.png');

// ─── PowerShell Helpers ───────────────────────────────────────────────────────

/**
 * Escape a string for use inside a PowerShell single-quoted literal.
 * Single quotes are doubled; newlines are collapsed to a space.
 */
function escapePSString(s: string): string {
  return s.replace(/'/g, "''").replace(/[\r\n]+/g, ' ');
}

// ─── Dispatch Channels ───────────────────────────────────────────────────────

/**
 * Try BurntToast high-fidelity toast:
 *   - Aura branded logo (assets/aura-logo.png)
 *   - Subject as bold title, body as detail line
 *   - Reminder chime for the scholarly midnight aesthetic
 *   - Attribution line anchors Aura identity at the bottom
 *
 * Silently fails (returns false) if BurntToast is not installed.
 */
function tryBurntToast(subject: string, body: string): boolean {
  const logo        = escapePSString(LOGO_PATH);
  const safeSubject = escapePSString(subject);
  const safeBody    = escapePSString(body);

  const cmd = [
    'Import-Module BurntToast -ErrorAction Stop',
    `New-BurntToastNotification`,
    `  -Text 'Aura', '${safeSubject}', '${safeBody}'`,
    `  -AppLogo '${logo}'`,
    `  -Sound 'Reminder'`,
    `  -Attribution 'Local Context Intelligence'`,
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NonInteractive', '-Command', cmd], {
    timeout: 10000,
    encoding: 'utf-8',
  });
  return result.status === 0;
}

/**
 * Try a System.Windows.Forms balloon tip. Returns true on success.
 * Available on all Windows systems without additional modules.
 */
function tryBalloonTip(subject: string, body: string): boolean {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$n = New-Object System.Windows.Forms.NotifyIcon',
    '$n.Icon = [System.Drawing.SystemIcons]::Information',
    '$n.Visible = $true',
    `$n.BalloonTipTitle = '${escapePSString(subject)}'`,
    `$n.BalloonTipText  = '${escapePSString(body)}'`,
    '$n.ShowBalloonTip(6000)',
    'Start-Sleep -Milliseconds 2000',
    '$n.Dispose()',
  ].join('; ');

  const result = spawnSync('powershell.exe', ['-NonInteractive', '-Command', script], {
    timeout: 12000,
    encoding: 'utf-8',
  });
  return result.status === 0;
}

// ─── Public Dispatch API ──────────────────────────────────────────────────────

export type DispatchMethod = 'burnt-toast' | 'balloon' | 'failed';

/**
 * Fire a single notification. Tries each channel in order.
 * Returns which channel succeeded, or 'failed' if all channels failed.
 */
export function dispatchNotification(notification: Notification): DispatchMethod {
  const { subject, body } = notification;
  if (tryBurntToast(subject, body)) return 'burnt-toast';
  if (tryBalloonTip(subject, body))  return 'balloon';
  return 'failed';
}

// ─── Queue Drain ─────────────────────────────────────────────────────────────

export interface DrainResult {
  dispatched: number;
  failed:     number;
  method:     DispatchMethod | null;
}

/**
 * Drain the notification queue:
 *   - Dispatch each pending notification.
 *   - Append a SentReceipt to sentLogPath on success.
 *   - Retry up to maxRetries; on exhaustion move to deadLetterPath.
 *   - Atomically update queuePath with any remaining items.
 *
 * Returns a summary of what happened.
 */
export function drainQueue(
  queuePath:      string,
  sentLogPath:    string,
  deadLetterPath: string,
): DrainResult {
  if (!existsSync(queuePath)) return { dispatched: 0, failed: 0, method: null };

  let queue: Notification[];
  try {
    queue = JSON.parse(readFileSync(queuePath, 'utf-8')) as Notification[];
  } catch {
    return { dispatched: 0, failed: 0, method: null };
  }

  if (queue.length === 0) return { dispatched: 0, failed: 0, method: null };

  let dispatched   = 0;
  let failed       = 0;
  let lastMethod: DispatchMethod | null = null;
  const remaining: Notification[]       = [];

  for (const notification of queue) {
    const startedAt = Date.now();
    const method    = dispatchNotification(notification);
    lastMethod      = method;

    if (method !== 'failed') {
      dispatched++;
      const receipt: SentReceipt = {
        id:              notification.id,
        enqueuedAt:      notification.ts,
        sentAt:          new Date().toISOString(),
        channel:         notification.channel,
        subject:         notification.subject,
        durationMs:      Date.now() - startedAt,
        gatewayResponse: method,
      };
      appendFileSync(sentLogPath, JSON.stringify(receipt) + '\n', 'utf-8');
    } else {
      notification.retries++;
      if (notification.retries >= notification.maxRetries) {
        const entry: DeadLetterEntry = {
          id:         notification.id,
          enqueuedAt: notification.ts,
          failedAt:   new Date().toISOString(),
          channel:    notification.channel,
          subject:    notification.subject,
          retries:    notification.retries,
          lastError:  'All dispatch channels failed (BurntToast + balloon)',
        };
        appendFileSync(deadLetterPath, JSON.stringify(entry) + '\n', 'utf-8');
        failed++;
      } else {
        remaining.push(notification); // back in queue for next drain
      }
    }
  }

  // Atomic-ish write: rename tmp over original
  const tmp = queuePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(remaining, null, 2), 'utf-8');
  try {
    renameSync(tmp, queuePath);
  } catch {
    writeFileSync(queuePath, JSON.stringify(remaining, null, 2), 'utf-8');
  }

  return { dispatched, failed, method: lastMethod };
}
