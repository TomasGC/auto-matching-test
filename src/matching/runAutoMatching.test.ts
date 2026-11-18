import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db';
import { runAutoMatching } from './runAutoMatching';

// These tests really commit: each one uses a company of its own, on the test database that is dropped at the end.
let reportDirectory: string;
let created: { companyId: string; accountId: string } | undefined;

beforeEach(async () => {
  reportDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'run-reports-'));
  process.env.REPORT_DIRECTORY = reportDirectory;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  delete process.env.REPORT_DIRECTORY;
  vi.restoreAllMocks();
  await fs.rm(reportDirectory, { recursive: true, force: true });
  if (created) {
    await db.query('delete from transaction where account_id = $1', [created.accountId]);
    await db.query('delete from buying_invoice where company_id = $1', [created.companyId]);
    await db.query('delete from account where id = $1', [created.accountId]);
    await db.query('delete from company where id = $1', [created.companyId]);
    created = undefined;
  }
});

afterAll(async () => {
  await db.end();
});

async function createCompany(): Promise<string> {
  const siren = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const company = { companyId: randomUUID(), accountId: randomUUID() };
  await db.query('insert into company (id, siren, name) values ($1, $2, $3)', [company.companyId, siren, 'Company']);
  await db.query('insert into account (id, company_id, iban) values ($1, $2, $3)', [
    company.accountId,
    company.companyId,
    'FR7600000000000000000000000',
  ]);
  created = company;
  return siren;
}

// An invoice of taxFree + vat, due on 2026-06-20.
async function addInvoice(taxFree: string, vat: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into buying_invoice
       (id, company_id, supplier_name, invoice_number, tax_free_total, vat_amount, due_date, invoice_status)
     values ($1, $2, 'Supplier', $3, $4, $5, '2026-06-20', 'ToPay')`,
    [id, created?.companyId, `INV-${id}`, taxFree, vat],
  );
  return id;
}

async function addTransaction(amount: string, date: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into transaction (id, account_id, remote_id, amount, label, reference, status, date)
     values ($1, $2, $3, $4, 'PRLV SEPA', '', 'Booked', $5)`,
    [id, created?.accountId, randomUUID(), amount, date],
  );
  return id;
}

async function matchedInvoiceOf(transactionId: string): Promise<string | null> {
  const { rows } = await db.query('select matched_invoice_id from transaction where id = $1', [transactionId]);
  return rows[0].matched_invoice_id;
}

async function readReport(): Promise<string> {
  const files = await fs.readdir(reportDirectory);
  expect(files).toHaveLength(1);
  return fs.readFile(path.join(reportDirectory, files[0]), 'utf8');
}

// A folder name that is a file: writing a report there fails.
async function blockReports(): Promise<void> {
  const blocked = path.join(reportDirectory, 'blocked');
  await fs.writeFile(blocked, 'not a folder');
  process.env.REPORT_DIRECTORY = blocked;
}

describe('runAutoMatching: a run that goes through', () => {
  it('saves the matches, writes the report and prints the summary', async () => {
    const siren = await createCompany();
    const invoice = await addInvoice('100.00', '20.00');
    const transaction = await addTransaction('-120.00', '2026-06-15');

    await runAutoMatching(siren);

    expect(await matchedInvoiceOf(transaction)).toBe(invoice);
    const report = await readReport();
    expect(report).toContain('Status: completed');
    expect(report).toContain('Matched: 1');
    expect(console.log).toHaveBeenCalledWith(
      'Matched 1 of 1 transactions: 0 ambiguous, 0 in conflict, 0 without candidate',
    );
  });

  it('keeps the matches when the report cannot be written, and still fails', async () => {
    const siren = await createCompany();
    const invoice = await addInvoice('100.00', '20.00');
    const transaction = await addTransaction('-120.00', '2026-06-15');
    await blockReports();

    await expect(runAutoMatching(siren)).rejects.toThrow();

    expect(await matchedInvoiceOf(transaction)).toBe(invoice);
  });
});

describe('runAutoMatching: a run that fails', () => {
  it('writes a failure report when the company does not exist', async () => {
    await createCompany();

    await expect(runAutoMatching('000000000')).rejects.toThrow('No company with SIREN 000000000');

    const report = await readReport();
    expect(report).toContain('Status: FAILED, nothing was saved');
    expect(report).toContain('Error: No company with SIREN 000000000');
  });

  it('throws the original error when the failure report cannot be written either', async () => {
    await createCompany();
    await blockReports();

    await expect(runAutoMatching('000000000')).rejects.toThrow('No company with SIREN 000000000');

    expect(console.error).toHaveBeenCalledWith('The report could not be written:', expect.any(Error));
  });

  it('saves none of the matches when the writing of a later one fails', async () => {
    const siren = await createCompany();
    await addInvoice('100.00', '20.00');
    await addInvoice('200.00', '40.00');
    const first = await addTransaction('-120.00', '2026-06-15');
    const second = await addTransaction('-240.00', '2026-06-16');
    // The job saves the transactions in date order: the second update fails, after the first one went through.
    await db.query(`
      create function fail_for_test() returns trigger language plpgsql as $$
      begin
        if new.id = '${second}' then raise exception 'forced failure'; end if;
        return new;
      end $$`);
    await db.query(
      'create trigger fail_for_test before update on transaction for each row execute function fail_for_test()',
    );
    try {
      await expect(runAutoMatching(siren)).rejects.toThrow('forced failure');
    } finally {
      await db.query('drop trigger fail_for_test on transaction');
      await db.query('drop function fail_for_test()');
    }

    expect(await matchedInvoiceOf(first)).toBeNull();
    expect(await matchedInvoiceOf(second)).toBeNull();
    expect(await readReport()).toContain('Status: FAILED, nothing was saved');
  });
});
