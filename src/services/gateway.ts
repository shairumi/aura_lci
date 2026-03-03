/**
 * Local Mock Gateway — The Secretary's dispatch endpoint.
 *
 * This is a LOCAL-ONLY service. It simulates notification delivery
 * without any network calls. All output goes to local log files.
 *
 * Privacy guarantee: No data transmitted externally.
 */

import type { GatewayResponse, Notification, NotificationChannel } from '../types/index.js';

// ─── Channel Handlers ─────────────────────────────────────────────────────────

function dispatchSystem(notification: Notification): GatewayResponse {
  // In production, this would call the OS notification API (node-notifier, etc.)
  // For now, simulate with a console write to a local log.
  const ts = new Date().toISOString();
  console.log(`[GATEWAY:system] ${ts} — ${notification.subject}`);
  return { success: true, message: 'Simulated system notification', timestamp: ts };
}

function dispatchInApp(notification: Notification): GatewayResponse {
  const ts = new Date().toISOString();
  console.log(`[GATEWAY:in-app] ${ts} — ${notification.subject}: ${notification.body}`);
  return { success: true, message: 'Simulated in-app notification', timestamp: ts };
}

function dispatchFile(notification: Notification): GatewayResponse {
  // Writes a human-readable notification to data/notifications/inbox.txt
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${notification.subject}\n${notification.body}\n---\n`;
  console.log(`[GATEWAY:file] ${ts} — written to inbox: ${notification.subject}`);
  // Actual file write happens in the Secretary agent to keep gateway side-effect-free
  return { success: true, message: entry, timestamp: ts };
}

// ─── Public API ───────────────────────────────────────────────────────────────

const CHANNEL_HANDLERS: Record<
  NotificationChannel,
  (n: Notification) => GatewayResponse
> = {
  system: dispatchSystem,
  'in-app': dispatchInApp,
  file: dispatchFile,
};

/**
 * Dispatch a single notification through the appropriate local channel.
 * Returns a GatewayResponse indicating success or failure.
 * Never throws — all errors are captured in the response.
 */
export function dispatch(notification: Notification): GatewayResponse {
  const handler = CHANNEL_HANDLERS[notification.channel];

  if (!handler) {
    return {
      success: false,
      message: `Unknown channel: ${notification.channel}`,
      timestamp: new Date().toISOString(),
    };
  }

  try {
    return handler(notification);
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
      timestamp: new Date().toISOString(),
    };
  }
}
