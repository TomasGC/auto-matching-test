import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connectionConfig } from './db';

// The migration is played on data written with the initial schema (real amounts, due dates as text),
// on its own database, so the seed and the other tests are not involved.
const DATABASE = 'matching_migration_test';
const MIGRATIONS = path.join(__dirname, '..', 'migrations');
const INITIAL_SCHEMA = fs.readFileSync(path.join(MIGRATIONS, '20260101000000_initial_schema.sql'), 'utf8');
const INTEGRITY_MIGRATION = fs.readFileSync(path.join(MIGRATIONS, '20260102000000_matching_integrity.sql'), 'utf8');

const COMPANY = '10000000-0000-4000-8000-000000000001';
const ACCOUNT = '20000000-0000-4000-8000-000000000001';
const INVOICE = '30000000-0000-4000-8000-000000000001';
const INVOICE_WITHOUT_DUE_DATE = '30000000-0000-4000-8000-000000000002';
const TRANSACTION = '40000000-0000-4000-8000-000000000001';
const OTHER_TRANSACTION = '40000000-0000-4000-8000-000000000002';

let admin: Client;
let client: Client;

beforeAll(async () => {
  admin = new Client({ ...connectionConfig, database: 'postgres' });
  await admin.connect();
  await admin.query(`drop database if exists ${DATABASE} with (force)`);
  await admin.query(`create database ${DATABASE}`);

  client = new Client({ ...connectionConfig, database: DATABASE });
  await client.connect();
  await client.query(INITIAL_SCHEMA);
  await client.query(`
    insert into company (id, siren, name) values ('${COMPANY}', '111111111', 'Company');
    insert into account (id, company_id, iban) values ('${ACCOUNT}', '${COMPANY}', 'FR76');
    insert into buying_invoice
      (id, company_id, supplier_name, invoice_number, tax_free_total, vat_amount, due_date, invoice_status)
      values
      ('${INVOICE}', '${COMPANY}', 'Supplier', 'INV-1', 512.83, 102.57, '2026-06-01', 'ToPay'),
      ('${INVOICE_WITHOUT_DUE_DATE}', '${COMPANY}', 'Supplier', 'INV-2', 400, 80, NULL, 'ToPay');
    insert into transaction (id, account_id, remote_id, amount, label, reference, status, date)
      values
      ('${TRANSACTION}', '${ACCOUNT}', 'r1', -12345.67, 'PRLV', '', 'Booked', '2026-06-03'),
      ('${OTHER_TRANSACTION}', '${ACCOUNT}', 'r2', -615.4, 'PRLV', '', 'Booked', '2026-06-03');
  `);
  await client.query(INTEGRITY_MIGRATION);
});

afterAll(async () => {
  await client.end();
  await admin.query(`drop database if exists ${DATABASE} with (force)`);
  await admin.end();
});

describe('matching integrity migration, on data written before it', () => {
  it('shows why the cast goes through text: a direct real to numeric cast loses cents', async () => {
    const { rows } = await client.query(
      `select 12345.67::real::numeric(12, 2)::text as direct, 12345.67::real::text::numeric(28, 2)::text as via_text`,
    );
    expect(rows[0]).toEqual({ direct: '12345.70', via_text: '12345.67' });
  });

  it('keeps the amounts to the cent', async () => {
    const { rows } = await client.query(
      `select t.amount::text as amount, (i.tax_free_total + i.vat_amount)::text as total
       from transaction t, buying_invoice i
       where t.id = $1 and i.id = $2`,
      [TRANSACTION, INVOICE],
    );
    expect(rows[0]).toEqual({ amount: '-12345.67', total: '615.40' });
  });

  it('makes the due date a real date, and keeps a missing one missing', async () => {
    const { rows } = await client.query(
      `select id, due_date::text as due_date, pg_typeof(due_date)::text as type
       from buying_invoice order by id`,
    );
    expect(rows).toEqual([
      { id: INVOICE, due_date: '2026-06-01', type: 'date' },
      { id: INVOICE_WITHOUT_DUE_DATE, due_date: null, type: 'date' },
    ]);
  });

  it('forbids a missing amount', async () => {
    const { rows } = await client.query(
      `select table_name, column_name from information_schema.columns
       where table_schema = 'public' and is_nullable = 'NO'
         and column_name in ('amount', 'tax_free_total', 'vat_amount')
       order by table_name, column_name`,
    );
    expect(rows).toEqual([
      { table_name: 'buying_invoice', column_name: 'tax_free_total' },
      { table_name: 'buying_invoice', column_name: 'vat_amount' },
      { table_name: 'transaction', column_name: 'amount' },
    ]);
  });

  it('can be played again without error or change', async () => {
    await client.query(INTEGRITY_MIGRATION);
    const { rows } = await client.query('select amount::text as amount from transaction where id = $1', [TRANSACTION]);
    expect(rows[0].amount).toBe('-12345.67');
  });

  it('refuses an unknown status', async () => {
    await expect(
      client.query(`update transaction set status = 'booked' where id = $1`, [TRANSACTION]),
    ).rejects.toThrow(/transaction_status_check/);
    await expect(
      client.query(`update buying_invoice set invoice_status = 'paid' where id = $1`, [INVOICE]),
    ).rejects.toThrow(/buying_invoice_status_check/);
  });

  it('refuses two transactions on the same invoice', async () => {
    await client.query('update transaction set matched_invoice_id = $1 where id = $2', [INVOICE, TRANSACTION]);
    await expect(
      client.query('update transaction set matched_invoice_id = $1 where id = $2', [INVOICE, OTHER_TRANSACTION]),
    ).rejects.toThrow(/transaction_matched_invoice_unique/);
  });
});
