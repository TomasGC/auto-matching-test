import { PoolClient } from 'pg';
import { db } from '../db';
import { Outcome, matchAll } from './matchAll';
import { MatchKind } from './matchKind';
import { Run, formatFailure, formatReport, formatSummary } from './report';
import { writeReport } from './reportFile';
import { Invoice, Transaction } from './types';

const MATCHABLE_TRANSACTION_STATUS = 'Booked';
const MATCHABLE_INVOICE_STATUSES = ['Pending', 'ToPay'];

async function getCompanyId(client: PoolClient, siren: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>('select id from company where siren = $1', [siren]);
  if (rows.length === 0) {
    throw new Error(`No company with SIREN ${siren}`);
  }
  return rows[0].id;
}

// Two runs on the same company would match the same invoices twice: the second one stops.
// The lock is released at the end of the database transaction.
async function lockCompany(client: PoolClient, companyId: string): Promise<void> {
  const { rows } = await client.query<{ locked: boolean }>(
    'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
    [`auto-matching:${companyId}`],
  );
  if (!rows[0].locked) {
    throw new Error(`A matching run is already in progress for company ${companyId}`);
  }
}

// Outgoing, booked, not deleted and not matched yet.
async function getTransactions(client: PoolClient, companyId: string): Promise<Transaction[]> {
  const { rows } = await client.query<Transaction>(
    `select t.id, abs(t.amount)::text as amount, coalesce(t.label, '') as label, t.date
     from transaction t
     join account a on a.id = t.account_id
     where a.company_id = $1
       and t.amount < 0
       and t.status = $2
       and t.deleted_at is null
       and t.matched_invoice_id is null
     order by t.date, t.id`,
    [companyId, MATCHABLE_TRANSACTION_STATUS],
  );
  return rows;
}

// Not deleted, still to pay, with a due date, and not already matched by a transaction.
async function getInvoices(client: PoolClient, companyId: string): Promise<Invoice[]> {
  const { rows } = await client.query<Invoice>(
    `select i.id, i.supplier_name, i.invoice_number, (i.tax_free_total + i.vat_amount)::text as amount, i.due_date
     from buying_invoice i
     where i.company_id = $1
       and i.deleted_at is null
       and i.invoice_status = any($2)
       and i.due_date is not null
       and not exists (
         select 1 from transaction t
         where t.matched_invoice_id = i.id and t.deleted_at is null
       )`,
    [companyId, MATCHABLE_INVOICE_STATUSES],
  );
  return rows;
}

async function saveMatch(client: PoolClient, transactionId: string, invoiceId: string): Promise<void> {
  const { rowCount } = await client.query(
    'update transaction set matched_invoice_id = $1 where id = $2 and matched_invoice_id is null',
    [invoiceId, transactionId],
  );
  if (rowCount !== 1) {
    throw new Error(`Transaction ${transactionId} could not be matched: it changed during the run`);
  }
}

// The caller owns the database transaction: it commits when this function returns, and rolls back when it throws.
export async function matchCompany(client: PoolClient, companySiren: string): Promise<Outcome[]> {
  const companyId = await getCompanyId(client, companySiren);
  await lockCompany(client, companyId);

  const transactions = await getTransactions(client, companyId);
  const invoices = await getInvoices(client, companyId);
  const outcomes = matchAll(transactions, invoices);

  for (const outcome of outcomes) {
    if (outcome.kind === MatchKind.Matched) {
      await saveMatch(client, outcome.transaction.id, outcome.invoice.id);
    }
  }
  return outcomes;
}

// One database transaction for the whole run: either every match is saved, or none.
async function matchInTransaction(companySiren: string): Promise<Outcome[]> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const outcomes = await matchCompany(client, companySiren);
    await client.query('commit');
    return outcomes;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

// Every run leaves a report file, whether it went through or not.
export async function runAutoMatching(companySiren: string): Promise<void> {
  const run: Run = { siren: companySiren, run_at: new Date() };
  let outcomes: Outcome[];
  try {
    outcomes = await matchInTransaction(companySiren);
  } catch (error) {
    await writeReport(formatFailure(error, run), run.siren, run.run_at).then(
      (file) => console.error(`Report: ${file}`),
      (reportError) => console.error('The report could not be written:', reportError),
    );
    throw error;
  }
  const file = await writeReport(formatReport(outcomes, run), run.siren, run.run_at);
  console.log(formatSummary(outcomes));
  console.log(`Report: ${file}`);
}
