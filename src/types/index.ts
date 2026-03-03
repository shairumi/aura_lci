// Core type definitions for the Aura LCI system

// ─── Identity ────────────────────────────────────────────────────────────────

export type ConfidenceScore = number; // 0–100

export interface IdentityField {
  value: string | null;
  source: string;
  confidence: ConfidenceScore;
  updatedAt: string; // ISO timestamp
  userEdited?: boolean;
}

export interface ActiveFocusEntry {
  ts: string;
  filename: string;
  tone: string;
  confidence: number;
  keywords: string[];
  source: 'librarian-signal';
}

export interface UserIdentity {
  lastUpdated: string;
  overallConfidence: ConfidenceScore;
  activeFocus: ActiveFocusEntry | null;
  linguistic: {
    primaryLanguage: IdentityField;
    secondaryLanguages: IdentityField;
    script: IdentityField;
    register: IdentityField;
    vocabularyDomain: IdentityField;
    dateFormat: IdentityField;
    numberFormat: IdentityField;
  };
  geographic: {
    timezone: IdentityField;
    utcOffset: IdentityField;
    localeRegion: IdentityField;
    countryCode: IdentityField;
    hemisphere: IdentityField;
    activeHoursLocal: IdentityField;
    peakProductivityWindow: IdentityField;
  };
  lifeStage: {
    workMode: IdentityField;
    activityPattern: IdentityField;
    deviceRole: IdentityField;
    recentFocusAreas: IdentityField;
    projectCadence: IdentityField;
    collaborationIndicators: IdentityField;
  };
  cultural: {
    calendarSystem: IdentityField;
    weekStartDay: IdentityField;
    timeFormat: IdentityField;
    measurementSystem: IdentityField;
    currency: IdentityField;
    colorThemePreference: IdentityField;
    appLanguagePreference: IdentityField;
  };
}

// ─── Signals ─────────────────────────────────────────────────────────────────

export type SignalType =
  | 'timezone'
  | 'locale'
  | 'language'
  | 'file_activity'
  | 'extension_pattern'
  | 'active_hours'
  | 'os_theme'
  | 'system_env';

export interface Signal {
  ts: string; // ISO timestamp
  agent: AgentName;
  signal: SignalType;
  value: string;
  confidence: ConfidenceScore;
}

// ─── File Signals (Librarian pipeline) ───────────────────────────────────────

export type FileEventType = 'add' | 'change' | 'unlink';
export type WatchedRoot = 'downloads' | 'project-data' | 'git';

export interface FileSignal {
  ts: string;
  agent: 'librarian';
  event: FileEventType;
  watchedRoot: WatchedRoot;
  filename: string;   // basename only — never full path
  ext: string | null;
  sizeBytes: number | null;
  mtimeMs: number | null;
  processed: boolean; // false = awaiting Ethnographer
}

export interface VibeCheckResult {
  tone: string;
  secondaryTone: string | null;
  confidence: number;
  keywords: string[];
  label: string;      // human-readable vibe tag
  updatedIdentity: boolean;
}

export interface EnrichedSignal extends FileSignal {
  processed: true;
  vibeCheck: VibeCheckResult;
  enrichedAt: string; // ISO
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export type AgentName =
  | 'ethnographer' | 'librarian' | 'secretary'
  | 'chronicler'  | 'strategist'
  | 'financial-advisor' | 'monitor';
export type AgentStatus = 'idle' | 'running' | 'error';

export interface Mission {
  id: string;
  target: AgentName;
  type: string;
  payload?: Record<string, unknown>;
  enqueuedAt: string;
  priority: 'high' | 'normal' | 'low';
}

export interface CompletedMission extends Mission {
  completedAt: string;
  result: 'success' | 'partial' | 'failure';
  notes?: string;
}

export interface SquadState {
  lastSync: string;
  commitCount: number;
  agentStatus: Record<AgentName, AgentStatus>;
  pendingMissions: Mission[];
  completedMissions: CompletedMission[];
  alerts: SquadAlert[];
}

export interface SquadAlert {
  id: string;
  ts: string;
  severity: 'info' | 'warning' | 'critical';
  agent: AgentName | 'general';
  message: string;
  resolved: boolean;
}

// ─── File Watcher ─────────────────────────────────────────────────────────────

export interface LibrarianEvent {
  ts: string;
  agent: 'librarian';
  event: FileEventType;
  path: string;       // watched root label only
  filename: string;   // basename only
  ext: string | null;
  sizeBytes: number | null;
  mtimeMs: number | null;
}

export interface LibrarianSnapshot {
  ts: string;
  watchedPaths: string[];
  fileCounts: Record<string, number>;
  extensionBreakdown: Record<string, number>;
  recentEvents: number;
  largestFileBytes: number;
  oldestFileMtimeMs: number;
}

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationChannel = 'system' | 'in-app' | 'file';
export type NotificationPriority = 'high' | 'normal' | 'low';

export interface Notification {
  id: string;
  ts: string;
  priority: NotificationPriority;
  channel: NotificationChannel;
  recipient: 'user';
  subject: string;
  body: string;
  metadata: Record<string, unknown>;
  retries: number;
  maxRetries: number;
}

export interface GatewayResponse {
  success: boolean;
  message: string;
  timestamp: string;
}

export interface SentReceipt {
  id: string;
  enqueuedAt: string;
  sentAt: string;
  channel: NotificationChannel;
  subject: string;
  durationMs: number;
  gatewayResponse: string;
}

export interface DeadLetterEntry {
  id: string;
  enqueuedAt: string;
  failedAt: string;
  channel: NotificationChannel;
  subject: string;
  retries: number;
  lastError: string;
}

// ─── Git / Dev Chronicle (Mission 5) ─────────────────────────────────────────

export interface DiffStats {
  filesChanged: number;
  insertions: number;
  deletions: number;
  changedFiles: string[];
}

export interface GitCommitSignal {
  ts: string;             // ISO — when signal was written
  agent: 'librarian';
  commitHash: string;     // full 40-char SHA
  shortHash: string;      // 7-char short SHA
  subject: string;        // first line of commit message
  body: string;           // remaining commit message (may be empty)
  author: string;
  authorEmail: string;
  commitTimestamp: string; // ISO — when git made the commit
  branch: string;
  diff: string;           // git show HEAD output (may be truncated)
  diffStats: DiffStats;
}

export interface DraftsReadySignal {
  ts: string;
  agent: 'chronicler';
  shortHash: string;
  subject: string;
  draftsDir: string;   // relative path, e.g. agents/secretary/drafts/abc1234
  drafts: string[];    // ['twitter.txt', 'linkedin.txt', 'substack.md']
}

// ─── Financial Intelligence (Demo Feature Set) ────────────────────────────────

export type FinancialCategory =
  | 'bank-statement' | 'tax-document' | 'investment'
  | 'payslip' | 'insurance' | 'receipt' | 'other-financial';

export interface FinancialFileSignal {
  ts: string;
  agent: 'librarian';
  filename: string;
  ext: string;
  sizeBytes: number | null;
  financialCategory: FinancialCategory;
  documentType: string;                          // "W-2", "Bank Statement", etc.
  institution: string | null;                    // "JPMorgan Chase", "IRS", etc.
  relevanceScore: number;                        // 0–100
  keywords: string[];                            // matched filename keywords (empty for content detection)
  detectionMethod: 'content' | 'filename' | 'manual';
}

export interface WealthActionPlanSignal {
  ts: string;
  agent: 'financial-advisor';
  filename: string;
  financialCategory: FinancialCategory;
  documentType: string;
  institution: string | null;
  relevanceScore: number;
  vaultPath: string;    // relative path to the .md file
  actionCount: number;
}

// ─── Strategy Vault (Mission 6) ───────────────────────────────────────────────

export type LocalFirstTheme =
  | 'local-first'
  | 'privacy-preserving'
  | 'latency-optimized'
  | 'personalization'
  | 'zero-egress'
  | 'agent-coordination'
  | 'data-residency'
  | 'offline-capable';

export interface StrategyVaultSignal {
  ts: string;
  agent: 'strategist';
  shortHash: string;
  subject: string;
  detectedThemes: LocalFirstTheme[];
  localFirstScore: number;       // 0–10
  pmInsight: string;             // one-sentence PM hook for LinkedIn opening
  vaultDir: string;              // relative path, e.g. agents/secretary/strategy-vault/abc1234
  outputs: string[];             // ['deep-dive.md', 'pm-tutorial.md', 'decision-log.md']
}
