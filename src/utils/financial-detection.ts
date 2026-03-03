/**
 * Financial Document Detection Utility
 *
 * Shared by The Librarian (live watcher) and The Financial Advisor (backfill scan + --classify).
 *
 * Detection hierarchy:
 *   1. Content scan  — read page 1 of the PDF, match against known financial phrases
 *   2. Filename      — fall back to keyword matching on the filename
 *   3. Manual        — buildManualSignal() for --classify overrides
 *
 * Privacy: PDF text is read into memory, matched, then immediately discarded.
 * Nothing is stored. The signal only ever records the category, not the content.
 */

import { createRequire } from 'module';
import { extname } from 'path';
import { readFileSync, existsSync } from 'fs';
import type { FinancialFileSignal, FinancialCategory } from '../types/index.js';

// ─── pdf-parse (CJS interop) ──────────────────────────────────────────────────

const _require = createRequire(import.meta.url);
type PdfData = { text: string };
const pdfParse = _require('pdf-parse') as (
  buf: Buffer,
  opts?: { max?: number },
) => Promise<PdfData>;

// ─── Content Patterns ─────────────────────────────────────────────────────────
// Matched against page 1 of the PDF. Order matters — more specific patterns first.

interface ContentPattern {
  pattern:      RegExp;
  category:     FinancialCategory;
  documentType: string;
  institution?: string;
}

const CONTENT_PATTERNS: ContentPattern[] = [
  // ── Tax documents ────────────────────────────────────────────────────────────
  { pattern: /W-?\s*2\s+(Wage\s+and\s+Tax\s+Statement|wage)/i,         category: 'tax-document', documentType: 'W-2' },
  { pattern: /Form\s+1099-?(DIV|INT|NEC|MISC|B|R|G|K|S|A|C|Q)?\b/i,   category: 'tax-document', documentType: '1099' },
  { pattern: /U\.S\.\s+Individual\s+Income\s+Tax\s+Return|Form\s+1040/i, category: 'tax-document', documentType: '1040 Tax Return' },
  { pattern: /OMB\s+No\.\s+1545-/i,                                     category: 'tax-document', documentType: 'IRS Form' },
  { pattern: /Schedule\s+[A-Z]\s*[-–—(]/i,                              category: 'tax-document', documentType: 'Tax Schedule' },
  { pattern: /Internal\s+Revenue\s+Service/i,                           category: 'tax-document', documentType: 'IRS Document', institution: 'IRS' },

  // ── Bank statements ───────────────────────────────────────────────────────────
  { pattern: /JPMorgan\s+Chase|Chase\s+Bank|JPMC/i,         category: 'bank-statement', documentType: 'Bank Statement', institution: 'JPMorgan Chase' },
  { pattern: /Wells\s+Fargo\s+Bank/i,                       category: 'bank-statement', documentType: 'Bank Statement', institution: 'Wells Fargo' },
  { pattern: /Bank\s+of\s+America/i,                        category: 'bank-statement', documentType: 'Bank Statement', institution: 'Bank of America' },
  { pattern: /Citibank|Citi\s+Bank/i,                       category: 'bank-statement', documentType: 'Bank Statement', institution: 'Citi' },
  { pattern: /US\s+Bank|U\.S\.\s+Bank/i,                    category: 'bank-statement', documentType: 'Bank Statement', institution: 'US Bank' },
  { pattern: /PNC\s+Bank/i,                                 category: 'bank-statement', documentType: 'Bank Statement', institution: 'PNC Bank' },
  { pattern: /Account\s+Statement|Statement\s+of\s+(Your\s+)?Account/i, category: 'bank-statement', documentType: 'Bank Statement' },
  { pattern: /Checking\s+Account\s*(Summary|Statement|Balance)/i,       category: 'bank-statement', documentType: 'Checking Account Statement' },
  { pattern: /Savings\s+Account\s*(Summary|Statement|Balance)/i,        category: 'bank-statement', documentType: 'Savings Account Statement' },

  // ── Investment ────────────────────────────────────────────────────────────────
  { pattern: /The\s+Vanguard\s+Group|Vanguard\s+Fund/i,    category: 'investment', documentType: 'Investment Summary', institution: 'Vanguard' },
  { pattern: /Fidelity\s+Investments|Fidelity\s+Brokerage/i, category: 'investment', documentType: 'Investment Summary', institution: 'Fidelity' },
  { pattern: /Charles\s+Schwab/i,                           category: 'investment', documentType: 'Investment Summary', institution: 'Charles Schwab' },
  { pattern: /401\s*\(k\)|403\s*\(b\)/i,                   category: 'investment', documentType: 'Retirement Account Statement' },
  { pattern: /Roth\s+IRA|Traditional\s+IRA|Individual\s+Retirement\s+Account/i, category: 'investment', documentType: 'IRA Statement' },
  { pattern: /Portfolio\s+(Summary|Statement|Overview|Review)/i,        category: 'investment', documentType: 'Investment Summary' },
  { pattern: /Brokerage\s+(Account\s+)?(Statement|Summary)/i,           category: 'investment', documentType: 'Brokerage Statement' },

  // ── Pay slips — patterns require payslip-specific context to avoid corporate P&L false positives
  { pattern: /Pay\s+(Stub|Slip|Advice)\b/i,                                             category: 'payslip', documentType: 'Pay Stub' },
  { pattern: /Employee\s+Pay\s+(Advice|Statement|Summary)/i,                            category: 'payslip', documentType: 'Pay Advice' },
  { pattern: /Earnings\s+Statement\b.*\bPay\s+Period\b|\bPay\s+Period\b.*Earnings\s+Statement\b/is, category: 'payslip', documentType: 'Pay Stub' },
  { pattern: /\bPay\s+Period\b.*\bGross\s+Pay\b|\bGross\s+Pay\b.*\bPay\s+Period\b/is,  category: 'payslip', documentType: 'Pay Stub' },
  { pattern: /\bEmployee\s+(ID|Number|Name)\b.*\bGross\s+Pay\b/is,                     category: 'payslip', documentType: 'Pay Stub' },

  // ── Insurance ─────────────────────────────────────────────────────────────────
  { pattern: /Explanation\s+of\s+Benefits|EOB\b/i,         category: 'insurance', documentType: 'Explanation of Benefits' },
  { pattern: /Certificate\s+of\s+Insurance/i,               category: 'insurance', documentType: 'Certificate of Insurance' },
  { pattern: /Declaration[s]?\s+Page/i,                     category: 'insurance', documentType: 'Insurance Declarations' },
  { pattern: /Insurance\s+Policy\b|Policy\s+Declaration/i,  category: 'insurance', documentType: 'Insurance Policy' },
  { pattern: /Premium\s+(Amount|Due|Notice|Statement)\b/i,  category: 'insurance', documentType: 'Insurance Premium Notice' },

  // ── Receipts ──────────────────────────────────────────────────────────────────
  { pattern: /Order\s+(Confirmation|Receipt)\b|Receipt\s+(Number|#|No\.)/i, category: 'receipt', documentType: 'Receipt' },
  { pattern: /Invoice\s+(Number|#|No\.)|INVOICE\s+#/i,                     category: 'receipt', documentType: 'Invoice' },
  { pattern: /Bill\s+To:|Billing\s+(Address|Summary|Statement)\b/i,         category: 'receipt', documentType: 'Bill' },
];

// ─── Filename Keywords (fallback) ─────────────────────────────────────────────

const FINANCIAL_KEYWORDS: Record<FinancialCategory, string[]> = {
  'bank-statement':  ['statement', 'bank', 'checking', 'savings', 'jpmc', 'chase', 'wellsfargo', 'bofa', 'bankofamerica', 'citi', 'usbank', 'pnc'],
  'tax-document':    ['tax', '1099', 'w2', 'w-2', '1040', 'irs', 'schedule', 'taxreturn', 'filing'],
  'investment':      ['investment', 'brokerage', 'portfolio', 'dividend', 'vanguard', 'fidelity', 'schwab', 'etrade', 'robinhood', '401k', 'ira', 'roth'],
  'payslip':         ['payslip', 'paystub', 'payroll', 'paycheck', 'salary', 'compensation'],
  'insurance':       ['insurance', 'policy', 'premium', 'coverage', 'claim'],
  'receipt':         ['receipt', 'invoice', 'billing', 'order'],
  'other-financial': [],
};

export const DOCUMENT_TYPE_LABELS: Record<FinancialCategory, string> = {
  'bank-statement':  'Bank Statement',
  'tax-document':    'Tax Document',
  'investment':      'Investment Summary',
  'payslip':         'Pay Slip',
  'insurance':       'Insurance Document',
  'receipt':         'Receipt / Invoice',
  'other-financial': 'Financial Document',
};

const INSTITUTION_PATTERNS: Array<[RegExp, string]> = [
  [/jpmc|chase/i,          'JPMorgan Chase'],
  [/irs/i,                 'IRS'],
  [/vanguard/i,            'Vanguard'],
  [/fidelity/i,            'Fidelity'],
  [/schwab/i,              'Charles Schwab'],
  [/etrade/i,              'E*TRADE'],
  [/robinhood/i,           'Robinhood'],
  [/wellsfargo/i,          'Wells Fargo'],
  [/bofa|bankofamerica/i,  'Bank of America'],
  [/citi(?:bank)?/i,       'Citi'],
  [/usbank/i,              'US Bank'],
  [/pnc/i,                 'PNC Bank'],
];

export const VALID_CATEGORIES: FinancialCategory[] = [
  'bank-statement', 'tax-document', 'investment',
  'payslip', 'insurance', 'receipt', 'other-financial',
];

// ─── Exclusion Patterns ───────────────────────────────────────────────────────
// Corporate/investor documents that contain financial vocabulary but are NOT
// personal finance records. Checked before any classification.

/**
 * If any of these match the PDF page-1 text, the document is a corporate or
 * investor-relations document and should not be classified as personal finance.
 */
const CORPORATE_CONTENT_EXCLUSIONS: RegExp[] = [
  /Earnings\s+Per\s+Share|Diluted\s+EPS\b/i,              // corporate P&L staple
  /\bPress\s+Release\b/i,                                  // earnings/results press releases
  /Non-GAAP|Reconciliation\s+of\s+GAAP/i,                 // corporate financial footnotes
  /\bInvestor\s+Relations\b/i,
  /Quarterly\s+(Results|Earnings|Report)\b/i,
  /Annual\s+(Results|Report)\b/i,
  /\b10-[KQ]\b|\b8-K\b/i,                                 // SEC filings
  /Consolidated\s+Statements?\s+of\s+(Income|Operations|Earnings)/i,
  /\bOperating\s+Income\b.*\bRevenue/is,                   // corporate income statement structure
  /\bFiscal\s+(Year|Quarter)\s+\d{4}\s+Results/i,
];

/**
 * If any of these match the filename, skip detection entirely.
 * Targets obviously corporate/non-personal filenames.
 */
const FILENAME_EXCLUSIONS: RegExp[] = [
  /earnings.?release|earnings.?report|earnings.?results/i,
  /annual.?report|quarterly.?report|quarterly.?results/i,
  /investor.?relations|press.?release/i,
  /10-[kq]|8-k/i,                                         // SEC filing names
  /q[1-4].{0,5}(results|earnings|report)/i,               // q4-results, q4-earnings
  /(results|earnings).{0,5}q[1-4]/i,                      // results-q4, earnings-q1
  /fiscal.?year.?\d{4}/i,
  /shareholder|stockholder/i,
];

// ─── Content Scanner ──────────────────────────────────────────────────────────

async function scanPdfContent(fullPath: string): Promise<ContentPattern | null> {
  try {
    const buffer = readFileSync(fullPath);
    const data   = await pdfParse(buffer, { max: 1 }); // first page only
    const text   = data.text ?? '';

    if (text.trim().length < 20) return null; // image-only or blank PDF

    // Reject corporate/investor documents before attempting classification
    for (const excl of CORPORATE_CONTENT_EXCLUSIONS) {
      if (excl.test(text)) return null;
    }

    for (const p of CONTENT_PATTERNS) {
      if (p.pattern.test(text)) return p;
    }
    return null;
  } catch {
    return null; // encrypted, corrupted, image-only, or not a real PDF
  }
}

// ─── Filename Detector ────────────────────────────────────────────────────────

function detectByFilename(
  filename: string,
): { category: FinancialCategory; keywords: string[]; institution: string | null } | null {
  const lower = filename.toLowerCase().replace(/[^a-z0-9]/g, '');

  let bestCategory: FinancialCategory | null = null;
  let bestMatches: string[] = [];

  for (const [cat, kws] of Object.entries(FINANCIAL_KEYWORDS) as [FinancialCategory, string[]][]) {
    if (cat === 'other-financial') continue;
    const matched = kws.filter(kw => lower.includes(kw.replace(/[^a-z0-9]/g, '')));
    if (matched.length > bestMatches.length) {
      bestCategory = cat;
      bestMatches  = matched;
    }
  }

  if (!bestCategory || bestMatches.length === 0) return null;

  let institution: string | null = null;
  for (const [pattern, name] of INSTITUTION_PATTERNS) {
    if (pattern.test(filename)) { institution = name; break; }
  }

  return { category: bestCategory, keywords: bestMatches, institution };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Primary classification entry point.
 *
 * Tries content scan first (PDF only), falls back to filename keywords.
 * Returns null if neither finds a financial match — caller should ignore the file.
 */
export async function classifyFinancialFile(
  filename:  string,
  fullPath:  string | null,
  sizeBytes: number | null,
): Promise<FinancialFileSignal | null> {
  const ext = extname(filename).toLowerCase();

  // 0. Filename exclusion — skip obviously corporate/non-personal documents
  for (const excl of FILENAME_EXCLUSIONS) {
    if (excl.test(filename)) return null;
  }

  // 1. Content scan — only for PDFs with a readable path
  if (fullPath && ext === '.pdf' && existsSync(fullPath)) {
    const match = await scanPdfContent(fullPath);
    if (match) {
      const score = Math.min(match.institution ? 85 : 70, 100);
      return {
        ts:                new Date().toISOString(),
        agent:             'librarian',
        filename,
        ext,
        sizeBytes,
        financialCategory: match.category,
        documentType:      match.documentType,
        institution:       match.institution ?? null,
        relevanceScore:    score,
        keywords:          [],
        detectionMethod:   'content',
      };
    }
  }

  // 2. Filename keyword fallback
  const fm = detectByFilename(filename);
  if (fm) {
    let score = 50;
    if (ext === '.pdf')      score += 20;
    if (fm.institution)      score += 15;
    score += Math.min(fm.keywords.length - 1, 2) * 10;
    score  = Math.min(score, 100);

    return {
      ts:                new Date().toISOString(),
      agent:             'librarian',
      filename,
      ext,
      sizeBytes,
      financialCategory: fm.category,
      documentType:      DOCUMENT_TYPE_LABELS[fm.category],
      institution:       fm.institution,
      relevanceScore:    score,
      keywords:          fm.keywords,
      detectionMethod:   'filename',
    };
  }

  return null;
}

/**
 * Build a signal from a user-supplied category (--classify flag).
 * Skips all detection — the user's judgement is the classification.
 */
export function buildManualSignal(
  filename:  string,
  category:  FinancialCategory,
  sizeBytes: number | null = null,
): FinancialFileSignal {
  const ext = extname(filename).toLowerCase();
  return {
    ts:                new Date().toISOString(),
    agent:             'librarian',
    filename,
    ext,
    sizeBytes,
    financialCategory: category,
    documentType:      DOCUMENT_TYPE_LABELS[category],
    institution:       null,
    relevanceScore:    60,
    keywords:          [],
    detectionMethod:   'manual',
  };
}
