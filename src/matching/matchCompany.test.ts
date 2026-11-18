import { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../db';
import { closeTestTransaction, openTestTransaction } from '../testing/testTransaction';
import { Outcome } from './matchAll';
import { MatchKind } from './matchKind';
import { matchCompany } from './runAutoMatching';

const SIREN = '900997767';

// Ids of the seed cases (seeds/seed.sql): transaction e000000N-…-0000000000K, invoice f000000N-…-0000000000K.
const transactionId = (seedCase: number, index = 1) =>
  `e${String(seedCase).padStart(7, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;
const invoiceId = (seedCase: number, index = 1) =>
  `f${String(seedCase).padStart(7, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;

let client: PoolClient;
let outcomes: Outcome[];

const outcomeOf = (id: string) => outcomes.find((outcome) => outcome.transaction.id === id);

// The matches found by the run, as pairs (transaction, invoice).
const matchedPairs = () =>
  outcomes.flatMap((outcome) =>
    outcome.kind === MatchKind.Matched
      ? [{ transaction_id: outcome.transaction.id, invoice_id: outcome.invoice.id }]
      : [],
  );

// One run on the seed, inside a database transaction that is rolled back at the end.
beforeAll(async () => {
  client = await openTestTransaction();
  outcomes = await matchCompany(client, SIREN);
});

afterAll(async () => {
  await closeTestTransaction(client);
  await db.end();
});

describe('matchCompany on the seed: designed cases', () => {
  it.each([
    ['Docusign: the only invoice of this amount', transactionId(1), invoiceId(1)],
    ['Bernard Conseil: 512.83 + 102.57 is exactly 615.40', transactionId(3), invoiceId(3)],
    ['SFRI SARL: the supplier named in the label, not SFR', transactionId(4), invoiceId(4, 2)],
    ['Martin: due exactly 30 days after the transaction', transactionId(7), invoiceId(7)],
    ['Assurance: the invoice has no supplier name', transactionId(13), invoiceId(13)],
    ['Sage: the supplier named in the label, not Qonto', transactionId(13, 2), invoiceId(13, 2)],
  ])('matches %s', (_name, transaction, invoice) => {
    expect(outcomeOf(transaction)).toMatchObject({ kind: MatchKind.Matched, invoice: { id: invoice } });
  });

  it('leaves FACT 0512 ambiguous between the two invoices of 240.00', () => {
    const outcome = outcomeOf(transactionId(2));
    expect(outcome?.kind).toBe(MatchKind.Ambiguous);
    expect(outcome).toMatchObject({ candidate_ids: expect.arrayContaining([invoiceId(2, 1), invoiceId(2, 2)]) });
  });

  it.each([
    ['the invoice is already matched (OVH, second payment)', transactionId(5, 2)],
    ['the invoice has no due date (Acme)', transactionId(6)],
    ['the invoice is paid (Adobe)', transactionId(8)],
    ['the invoice is deleted (Welcome to the Jungle)', transactionId(10)],
  ])('leaves the transaction without a match when %s', (_name, transaction) => {
    expect(outcomeOf(transaction)?.kind).toBe(MatchKind.None);
  });

  it('does not look at incoming money, at an account of another company, or at an already matched transaction', () => {
    expect(outcomeOf(transactionId(9))).toBeUndefined();
    expect(outcomeOf(transactionId(11))).toBeUndefined();
    expect(outcomeOf(transactionId(5, 1))).toBeUndefined();
  });

  it('matches neither of the two rent payments and traces the conflict', () => {
    const expected = {
      kind: MatchKind.Conflict,
      invoice_id: invoiceId(12),
      transaction_ids: [transactionId(12, 1), transactionId(12, 2)],
    };
    expect(outcomeOf(transactionId(12, 1))).toMatchObject(expected);
    expect(outcomeOf(transactionId(12, 2))).toMatchObject(expected);
  });
});

describe('matchCompany on the seed: what is written', () => {
  it('saves exactly the matches of the outcomes', async () => {
    const pairs = matchedPairs();
    const { rows } = await client.query(
      'select id as transaction_id, matched_invoice_id as invoice_id from transaction where id = any($1)',
      [pairs.map((pair) => pair.transaction_id)],
    );
    expect(pairs.length).toBeGreaterThan(0);
    expect(rows).toHaveLength(pairs.length);
    expect(rows).toEqual(expect.arrayContaining(pairs));
  });

  it('never writes a match that breaks a rule', async () => {
    const { rows } = await client.query<{ wrong: string; reused: string }>(
      `select
         count(*) filter (
           where t.amount >= 0
              or t.deleted_at is not null
              or t.status <> 'Booked'
              or i.deleted_at is not null
              or i.invoice_status not in ('Pending', 'ToPay')
              or i.due_date is null
              or abs(t.amount) <> i.tax_free_total + i.vat_amount
         ) as wrong,
         count(*) - count(distinct i.id) as reused
       from transaction t
       join buying_invoice i on i.id = t.matched_invoice_id
       where t.id = any($1)`,
      [matchedPairs().map((pair) => pair.transaction_id)],
    );
    expect(rows[0]).toEqual({ wrong: '0', reused: '0' });
  });

  it('refuses a second transaction on an invoice that is already matched (unique index)', async () => {
    await client.query('savepoint before_duplicate');
    await expect(
      client.query('update transaction set matched_invoice_id = $1 where id = $2', [
        invoiceId(4, 2),
        transactionId(2),
      ]),
    ).rejects.toThrow(/transaction_matched_invoice_unique/);
    await client.query('rollback to savepoint before_duplicate');
  });
});

describe('matchCompany: runs', () => {
  it('matches nothing more on a second run, and reports the same open cases', async () => {
    const second = await matchCompany(client, SIREN);
    const count = (list: Outcome[], kind: MatchKind) => list.filter((outcome) => outcome.kind === kind).length;
    expect(count(second, MatchKind.Matched)).toBe(0);
    expect(count(second, MatchKind.Ambiguous)).toBe(count(outcomes, MatchKind.Ambiguous));
    expect(count(second, MatchKind.Conflict)).toBe(count(outcomes, MatchKind.Conflict));
  });

  it('refuses a second run while another one holds the lock of the company', async () => {
    const other = await db.connect();
    try {
      await other.query('begin');
      await expect(matchCompany(other, SIREN)).rejects.toThrow(/already in progress/);
    } finally {
      await other.query('rollback');
      other.release();
    }
  });

  it('fails on an unknown SIREN', async () => {
    const other = await db.connect();
    try {
      await other.query('begin');
      await expect(matchCompany(other, '000000000')).rejects.toThrow('No company with SIREN 000000000');
    } finally {
      await other.query('rollback');
      other.release();
    }
  });
});
