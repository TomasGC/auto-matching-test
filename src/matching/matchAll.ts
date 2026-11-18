import { findMatch } from './findMatch';
import { MatchKind } from './matchKind';
import { Invoice, MatchResult, Transaction } from './types';

export type Outcome = { transaction: Transaction } & (
  | MatchResult
  | { kind: MatchKind.Conflict; invoice_id: string; transaction_ids: string[] }
);

function groupByAmount(invoices: Invoice[]): Map<string, Invoice[]> {
  const groups = new Map<string, Invoice[]>();
  for (const invoice of invoices) {
    groups.set(invoice.amount, [...(groups.get(invoice.amount) ?? []), invoice]);
  }
  return groups;
}

// Every transaction is judged against the same invoices, so the result does not depend on the order.
// When several transactions end on the same invoice, none of them is matched (conflict):
// it is probably a duplicated bank movement and a person has to look at it.
// The outcome keeps the ids involved, so the run can report what happened.
export function matchAll(transactions: Transaction[], invoices: Invoice[]): Outcome[] {
  const invoicesByAmount = groupByAmount(invoices);
  const results = transactions.map((transaction) => ({
    transaction,
    result: findMatch(transaction, invoicesByAmount.get(transaction.amount) ?? []),
  }));

  const transactionIdsByInvoice = new Map<string, string[]>();
  for (const { transaction, result } of results) {
    if (result.kind === MatchKind.Matched) {
      const ids = transactionIdsByInvoice.get(result.invoice.id) ?? [];
      transactionIdsByInvoice.set(result.invoice.id, [...ids, transaction.id]);
    }
  }

  return results.map(({ transaction, result }): Outcome => {
    if (result.kind === MatchKind.Matched) {
      const transactionIds = transactionIdsByInvoice.get(result.invoice.id) ?? [];
      if (transactionIds.length > 1) {
        return {
          transaction,
          kind: MatchKind.Conflict,
          invoice_id: result.invoice.id,
          transaction_ids: transactionIds,
        };
      }
    }
    return { transaction, ...result };
  });
}
