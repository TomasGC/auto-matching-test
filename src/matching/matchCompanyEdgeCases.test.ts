import { randomUUID } from 'crypto';
import { PoolClient } from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db';
import { closeTestTransaction, openTestTransaction } from '../testing/testTransaction';
import { Outcome } from './matchAll';
import { MatchKind } from './matchKind';
import { matchCompany } from './runAutoMatching';

// Cases the seed does not have. Each test inserts its own company in a transaction that is rolled back.
const SIREN = '999999999';

let client: PoolClient;
let companyId: string;
let accountId: string;

beforeEach(async () => {
  client = await openTestTransaction();
  companyId = await addCompany(SIREN);
  accountId = randomUUID();
  await client.query('insert into account (id, company_id, iban) values ($1, $2, $3)', [
    accountId,
    companyId,
    'FR7600000000000000000000000',
  ]);
});

afterEach(async () => {
  await closeTestTransaction(client);
});

afterAll(async () => {
  await db.end();
});

async function addCompany(siren: string): Promise<string> {
  const id = randomUUID();
  await client.query('insert into company (id, siren, name) values ($1, $2, $3)', [id, siren, `Company ${siren}`]);
  return id;
}

type InvoiceFields = {
  company_id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  tax_free_total: string;
  vat_amount: string;
  due_date: string | null;
  invoice_status: string;
  deleted_at: string | null;
};

// Default: an invoice of 120.00 to pay on 2026-06-20.
async function addInvoice(fields: Partial<InvoiceFields> = {}): Promise<string> {
  const id = randomUUID();
  const invoice: InvoiceFields = {
    company_id: companyId,
    supplier_name: 'Supplier',
    invoice_number: 'INV-1',
    tax_free_total: '100.00',
    vat_amount: '20.00',
    due_date: '2026-06-20',
    invoice_status: 'ToPay',
    deleted_at: null,
    ...fields,
  };
  await client.query(
    `insert into buying_invoice
       (id, company_id, supplier_name, invoice_number, tax_free_total, vat_amount, due_date, invoice_status, deleted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, invoice.company_id, invoice.supplier_name, invoice.invoice_number, invoice.tax_free_total,
      invoice.vat_amount, invoice.due_date, invoice.invoice_status, invoice.deleted_at],
  );
  return id;
}

type TransactionFields = {
  amount: string;
  label: string | null;
  status: string;
  date: string;
  deleted_at: string | null;
};

// Default: a booked payment of 120.00 on 2026-06-15.
async function addTransaction(fields: Partial<TransactionFields> = {}): Promise<string> {
  const id = randomUUID();
  const transaction: TransactionFields = {
    amount: '-120.00',
    label: 'PRLV SEPA',
    status: 'Booked',
    date: '2026-06-15',
    deleted_at: null,
    ...fields,
  };
  await client.query(
    `insert into transaction (id, account_id, remote_id, amount, label, reference, status, date, deleted_at)
     values ($1, $2, $3, $4, $5, '', $6, $7, $8)`,
    [id, accountId, randomUUID(), transaction.amount, transaction.label, transaction.status,
      transaction.date, transaction.deleted_at],
  );
  return id;
}

const outcomeOf = (outcomes: Outcome[], id: string) =>
  outcomes.find((outcome) => outcome.transaction.id === id);

describe('amounts', () => {
  it('matches an amount above 131000 to the cent, and saves it', async () => {
    const invoice = await addInvoice({ tax_free_total: '120000.01', vat_amount: '24000.00' });
    const transaction = await addTransaction({ amount: '-144000.01' });

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, transaction)).toMatchObject({ kind: MatchKind.Matched, invoice: { id: invoice } });
    const { rows } = await client.query('select matched_invoice_id from transaction where id = $1', [transaction]);
    expect(rows[0].matched_invoice_id).toBe(invoice);
  });

  it('does not match an amount that is one cent away', async () => {
    await addInvoice({ tax_free_total: '120000.02', vat_amount: '24000.00' });
    const transaction = await addTransaction({ amount: '-144000.01' });

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, transaction)?.kind).toBe(MatchKind.None);
  });
});

describe('due-date window (transaction on 2026-06-15)', () => {
  it.each([
    ['3 days before', '2026-06-12', MatchKind.Matched],
    ['4 days before', '2026-06-11', MatchKind.None],
    ['30 days after', '2026-07-15', MatchKind.Matched],
    ['31 days after', '2026-07-16', MatchKind.None],
  ])('due %s', async (_name, dueDate, expected) => {
    await addInvoice({ due_date: dueDate });
    const transaction = await addTransaction();

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, transaction)?.kind).toBe(expected);
  });
});

describe('the label', () => {
  it('picks the invoice whose number is named', async () => {
    const named = await addInvoice({ supplier_name: 'Alpha', invoice_number: 'FACT-0512' });
    await addInvoice({ supplier_name: 'Beta', invoice_number: 'FACT-0999' });
    const transaction = await addTransaction({ label: 'VIR FACT 0512' });

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, transaction)).toMatchObject({ kind: MatchKind.Matched, invoice: { id: named } });
  });

  it('stays ambiguous when the label names none of two invoices', async () => {
    await addInvoice({ supplier_name: 'Alpha', invoice_number: 'FACT-0512' });
    await addInvoice({ supplier_name: 'Beta', invoice_number: 'FACT-0999' });
    const transaction = await addTransaction({ label: 'VIR 12345' });

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, transaction)?.kind).toBe(MatchKind.Ambiguous);
  });

  it('matches a transaction without label when there is one candidate', async () => {
    const invoice = await addInvoice();
    const transaction = await addTransaction({ label: null });

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, transaction)).toMatchObject({ kind: MatchKind.Matched, invoice: { id: invoice } });
  });

  it('does not crash on a transaction without label when there are two candidates', async () => {
    await addInvoice({ supplier_name: 'Alpha' });
    await addInvoice({ supplier_name: 'Beta' });
    const transaction = await addTransaction({ label: null });

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, transaction)?.kind).toBe(MatchKind.Ambiguous);
  });
});

describe('what is left out', () => {
  it('does not use an invoice of another company', async () => {
    const otherCompany = await addCompany('888888888');
    await addInvoice({ company_id: otherCompany });
    const transaction = await addTransaction();

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, transaction)?.kind).toBe(MatchKind.None);
  });

  it.each([['Cancelled'], ['Paid']])('does not use a %s invoice', async (status) => {
    await addInvoice({ invoice_status: status });
    const transaction = await addTransaction();

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, transaction)?.kind).toBe(MatchKind.None);
  });

  it('does not use a deleted invoice', async () => {
    await addInvoice({ deleted_at: '2026-06-01 10:00:00' });
    const transaction = await addTransaction();

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, transaction)?.kind).toBe(MatchKind.None);
  });

  it('does not look at a pending or a deleted transaction', async () => {
    await addInvoice();
    const pending = await addTransaction({ status: 'Pending' });
    const deleted = await addTransaction({ deleted_at: '2026-06-16 09:00:00' });

    const outcomes = await matchCompany(client, SIREN);

    expect(outcomeOf(outcomes, pending)).toBeUndefined();
    expect(outcomeOf(outcomes, deleted)).toBeUndefined();
  });
});
