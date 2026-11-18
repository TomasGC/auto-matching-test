import { describe, expect, it } from 'vitest';
import { Outcome } from './matchAll';
import { MatchKind } from './matchKind';
import { Run, formatFailure, formatReport, formatSummary } from './report';
import { Invoice, Transaction } from './types';

function makeTransaction(id: string): Transaction {
  return { id, amount: '615.40', label: 'PRLV SEPA', date: '2026-06-15' };
}

const invoice: Invoice = {
  id: 'i1',
  supplier_name: 'Supplier',
  invoice_number: 'F-001',
  amount: '615.40',
  due_date: '2026-06-20',
};

const run: Run = { siren: '900997767', run_at: new Date('2026-11-18T09:12:03Z') };

const matched: Outcome = { transaction: makeTransaction('t1'), kind: MatchKind.Matched, invoice };
const none: Outcome = { transaction: makeTransaction('t2'), kind: MatchKind.None };
const ambiguous: Outcome = {
  transaction: makeTransaction('t4'),
  kind: MatchKind.Ambiguous,
  candidate_ids: ['i2', 'i3'],
};
const conflicts: Outcome[] = ['t5', 't6'].map((id) => ({
  transaction: makeTransaction(id),
  kind: MatchKind.Conflict,
  invoice_id: 'i4',
  transaction_ids: ['t5', 't6'],
}));

describe('formatSummary', () => {
  it('counts every kind of outcome', () => {
    const outcomes = [matched, none, { ...none }, ambiguous, ...conflicts];
    expect(formatSummary(outcomes)).toBe(
      'Matched 1 of 6 transactions: 1 ambiguous, 2 in conflict, 2 without candidate',
    );
  });

  it('works when there is nothing to process', () => {
    expect(formatSummary([])).toBe('Matched 0 of 0 transactions: 0 ambiguous, 0 in conflict, 0 without candidate');
  });
});

describe('formatReport', () => {
  it('starts with the company, the date and the status', () => {
    expect(formatReport([], run).slice(0, 4)).toEqual([
      'Auto-matching report',
      'Company: 900997767',
      'Run at: 2026-11-18T09:12:03.000Z',
      'Status: completed',
    ]);
  });

  it('gives the counts', () => {
    const lines = formatReport([matched, none, { ...none }, ambiguous, ...conflicts], run);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Processed: 6 transactions',
        'Matched: 1',
        'Ambiguous: 1',
        'Conflict: 2',
        'No candidate: 2',
      ]),
    );
  });

  it('describes an ambiguous case so that it can be found again', () => {
    expect(formatReport([ambiguous], run)).toContain(
      'ambiguous: transaction t4 (2026-06-15, 615.40, "PRLV SEPA") fits invoices i2, i3',
    );
  });

  it('gives one line per conflicting invoice, with every transaction involved', () => {
    const lines = formatReport(conflicts, run).filter((line) => line.startsWith('conflict:'));
    expect(lines).toEqual(['conflict: invoice i4 is wanted by transactions t5, t6']);
  });

  it('counts the problems it lists, and does not list matched or unmatched transactions', () => {
    const lines = formatReport([matched, none, ambiguous, ...conflicts], run);
    const start = lines.indexOf('Problems to look at (2):');
    expect(lines.slice(start + 1)).toHaveLength(2);
  });

  it('says so when there is no problem', () => {
    expect(formatReport([matched, none], run).slice(-1)).toEqual(['Problems to look at (0):']);
  });
});

describe('formatFailure', () => {
  it('says that nothing was saved and gives the error', () => {
    expect(formatFailure(new Error('No company with SIREN 1'), run)).toEqual([
      'Auto-matching report',
      'Company: 900997767',
      'Run at: 2026-11-18T09:12:03.000Z',
      'Status: FAILED, nothing was saved',
      '',
      'Error: No company with SIREN 1',
    ]);
  });

  it('accepts a failure that is not an Error', () => {
    expect(formatFailure('boom', run).slice(-1)).toEqual(['Error: boom']);
  });
});
