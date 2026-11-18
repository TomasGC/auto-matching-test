import { describe, expect, it } from 'vitest';
import { findMatch } from './findMatch';
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

describe('findMatch: no match', () => {
  it('returns none without invoices', () => {
    expect(findMatch(makeTransaction(), [])).toEqual({ kind: MatchKind.None });
  });

  it('returns none when the amount differs by one cent', () => {
    const invoices = [makeInvoice({ amount: '615.41' })];
    expect(findMatch(makeTransaction(), invoices)).toEqual({ kind: MatchKind.None });
  });

  it('returns none when the due date is outside the window', () => {
    const invoices = [makeInvoice({ due_date: '2024-07-16' })];
    expect(findMatch(makeTransaction(), invoices)).toEqual({ kind: MatchKind.None });
  });
});

describe('findMatch: one candidate', () => {
  it('matches even when the label says nothing about the invoice', () => {
    const invoice = makeInvoice();
    expect(findMatch(makeTransaction({ label: 'VIR 12345' }), [invoice])).toEqual({
      kind: MatchKind.Matched,
      invoice,
    });
  });

  it('matches an invoice without supplier name and without number, and does not crash', () => {
    const invoice = makeInvoice({ supplier_name: null, invoice_number: null });
    expect(findMatch(makeTransaction(), [invoice])).toEqual({ kind: MatchKind.Matched, invoice });
  });

  it('ignores the invoices that do not fit the amount or the window', () => {
    const fits = makeInvoice({ id: 'fits' });
    const wrongAmount = makeInvoice({ id: 'wrong-amount', amount: '100.00' });
    const tooLate = makeInvoice({ id: 'too-late', due_date: '2024-09-01' });
    expect(findMatch(makeTransaction(), [wrongAmount, fits, tooLate])).toEqual({
      kind: MatchKind.Matched,
      invoice: fits,
    });
  });
});

describe('findMatch: several candidates', () => {
  it('matches the one whose supplier is named in the label', () => {
    const docusign = makeInvoice({ id: 'docusign', supplier_name: 'DocuSign' });
    const other = makeInvoice({ id: 'other', supplier_name: 'Other Corp' });
    const result = findMatch(makeTransaction({ label: 'PRLV DOCUSIGN EUROPE' }), [other, docusign]);
    expect(result).toEqual({ kind: MatchKind.Matched, invoice: docusign });
  });

  it('matches the one whose invoice number is named in the label', () => {
    const first = makeInvoice({ id: 'first', supplier_name: 'A', invoice_number: 'FACT-0512' });
    const second = makeInvoice({ id: 'second', supplier_name: 'B', invoice_number: 'FACT-0999' });
    const result = findMatch(makeTransaction({ label: 'VIR FACT 0512' }), [first, second]);
    expect(result).toEqual({ kind: MatchKind.Matched, invoice: first });
  });

  it('ignores accents and legal forms when reading the label', () => {
    const lumiere = makeInvoice({ id: 'lumiere', supplier_name: 'Atelier Lumière SAS' });
    const other = makeInvoice({ id: 'other', supplier_name: 'Other Corp' });
    const result = findMatch(makeTransaction({ label: 'ATELIER LUMIERE' }), [lumiere, other]);
    expect(result).toEqual({ kind: MatchKind.Matched, invoice: lumiere });
  });

  it('does not take a supplier whose name only starts like another (SFRI vs SFRIDGE)', () => {
    const sfri = makeInvoice({ id: 'sfri', supplier_name: 'SFRI SARL' });
    const sfridge = makeInvoice({ id: 'sfridge', supplier_name: 'Sfridge SAS' });
    const result = findMatch(makeTransaction({ label: 'PRLV SFRI SARL' }), [sfridge, sfri]);
    expect(result).toEqual({ kind: MatchKind.Matched, invoice: sfri });
  });

  it('stays ambiguous when no candidate is named, and lists the candidates', () => {
    const first = makeInvoice({ id: 'first', supplier_name: 'A' });
    const second = makeInvoice({ id: 'second', supplier_name: 'B' });
    expect(findMatch(makeTransaction({ label: 'VIR 12345' }), [first, second])).toEqual({
      kind: MatchKind.Ambiguous,
      candidate_ids: ['first', 'second'],
    });
  });

  it('stays ambiguous when several candidates are named (same supplier, recurring invoices)', () => {
    const first = makeInvoice({ id: 'first', supplier_name: 'Orange' });
    const second = makeInvoice({ id: 'second', supplier_name: 'Orange', due_date: '2024-06-25' });
    expect(findMatch(makeTransaction({ label: 'PRLV ORANGE' }), [first, second])).toEqual({
      kind: MatchKind.Ambiguous,
      candidate_ids: ['first', 'second'],
    });
  });

  it('does not let an empty or missing invoice number name every invoice', () => {
    const emptyNumber = makeInvoice({ id: 'empty', supplier_name: 'A', invoice_number: '' });
    const nullNumber = makeInvoice({ id: 'null', supplier_name: 'B', invoice_number: null });
    expect(findMatch(makeTransaction({ label: 'VIR 12345' }), [emptyNumber, nullNumber])).toEqual({
      kind: MatchKind.Ambiguous,
      candidate_ids: ['empty', 'null'],
    });
  });

  it('does not crash on a null supplier name among several candidates', () => {
    const noSupplier = makeInvoice({ id: 'none', supplier_name: null });
    const named = makeInvoice({ id: 'named', supplier_name: 'Sage' });
    const result = findMatch(makeTransaction({ label: 'PRLV SAGE' }), [noSupplier, named]);
    expect(result).toEqual({ kind: MatchKind.Matched, invoice: named });
  });
});
