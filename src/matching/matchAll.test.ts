import { describe, expect, it } from 'vitest';
import { matchAll } from './matchAll';
import { MatchKind } from './matchKind';
import { Invoice, Transaction } from './types';

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return { id: 't1', amount: '615.40', label: 'PRLV SEPA', date: '2024-06-15', ...overrides };
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'i1',
    supplier_name: 'Supplier',
    invoice_number: 'F-001',
    amount: '615.40',
    due_date: '2024-06-20',
    ...overrides,
  };
}

describe('matchAll', () => {
  it('returns one outcome per transaction, in the same order', () => {
    const transactions = [makeTransaction({ id: 't1' }), makeTransaction({ id: 't2', amount: '99.00' })];
    const outcomes = matchAll(transactions, [makeInvoice()]);
    expect(outcomes.map((outcome) => outcome.transaction.id)).toEqual(['t1', 't2']);
  });

  it('matches each transaction to the invoice of its own amount', () => {
    const first = makeInvoice({ id: 'i1', amount: '100.00' });
    const second = makeInvoice({ id: 'i2', amount: '200.00' });
    const transactions = [
      makeTransaction({ id: 't1', amount: '200.00' }),
      makeTransaction({ id: 't2', amount: '100.00' }),
    ];
    const outcomes = matchAll(transactions, [first, second]);
    expect(outcomes).toEqual([
      { transaction: transactions[0], kind: MatchKind.Matched, invoice: second },
      { transaction: transactions[1], kind: MatchKind.Matched, invoice: first },
    ]);
  });

  it('reports a transaction without invoice of its amount as none', () => {
    const transaction = makeTransaction({ amount: '1.00' });
    expect(matchAll([transaction], [makeInvoice()])).toEqual([{ transaction, kind: MatchKind.None }]);
  });

  it('keeps an ambiguous transaction ambiguous', () => {
    const transaction = makeTransaction();
    const invoices = [makeInvoice({ id: 'i1' }), makeInvoice({ id: 'i2' })];
    expect(matchAll([transaction], invoices)).toEqual([
      { transaction, kind: MatchKind.Ambiguous, candidate_ids: ['i1', 'i2'] },
    ]);
  });
});

describe('matchAll: conflicts', () => {
  it('matches none of two transactions that end on the same invoice, and traces them', () => {
    const invoice = makeInvoice({ id: 'rent' });
    const first = makeTransaction({ id: 't1' });
    const second = makeTransaction({ id: 't2' });
    expect(matchAll([first, second], [invoice])).toEqual([
      { transaction: first, kind: MatchKind.Conflict, invoice_id: 'rent', transaction_ids: ['t1', 't2'] },
      { transaction: second, kind: MatchKind.Conflict, invoice_id: 'rent', transaction_ids: ['t1', 't2'] },
    ]);
  });

  it('does not touch a third transaction that matches another invoice', () => {
    const rent = makeInvoice({ id: 'rent' });
    const other = makeInvoice({ id: 'other', amount: '50.00' });
    const transactions = [
      makeTransaction({ id: 't1' }),
      makeTransaction({ id: 't2' }),
      makeTransaction({ id: 't3', amount: '50.00' }),
    ];
    const outcomes = matchAll(transactions, [rent, other]);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual([
      MatchKind.Conflict,
      MatchKind.Conflict,
      MatchKind.Matched,
    ]);
  });

  it('gives the same outcomes whatever the order of the transactions', () => {
    const invoices = [makeInvoice({ id: 'rent' }), makeInvoice({ id: 'other', amount: '50.00' })];
    const transactions = [
      makeTransaction({ id: 't1' }),
      makeTransaction({ id: 't2' }),
      makeTransaction({ id: 't3', amount: '50.00' }),
    ];
    const forward = matchAll(transactions, invoices);
    const backward = matchAll([...transactions].reverse(), invoices).reverse();
    expect(backward.map((outcome) => outcome.kind)).toEqual(forward.map((outcome) => outcome.kind));
  });

  it('does not report a conflict for ambiguous transactions that share candidates', () => {
    const invoices = [makeInvoice({ id: 'i1' }), makeInvoice({ id: 'i2' })];
    const outcomes = matchAll([makeTransaction({ id: 't1' }), makeTransaction({ id: 't2' })], invoices);
    expect(outcomes.map((outcome) => outcome.kind)).toEqual([MatchKind.Ambiguous, MatchKind.Ambiguous]);
  });
});
