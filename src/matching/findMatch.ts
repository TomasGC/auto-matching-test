import { isDueNearTransaction } from './dates';
import { MatchKind } from './matchKind';
import { containsWords, supplierWords, toWords } from './text';
import { Invoice, MatchResult, Transaction } from './types';

// The label names the invoice when it contains the whole supplier name or the whole invoice number.
function labelNamesInvoice(transaction: Transaction, invoice: Invoice): boolean {
  const labelWords = toWords(transaction.label);
  return (
    containsWords(labelWords, supplierWords(invoice.supplier_name)) ||
    containsWords(labelWords, toWords(invoice.invoice_number))
  );
}

// A wrong match is worse than no match, so a match is only returned when it is clear:
// - one candidate fits the amount and the due date window, or
// - several fit, but exactly one is named in the label.
export function findMatch(transaction: Transaction, invoices: Invoice[]): MatchResult {
  const candidates = invoices.filter(
    (invoice) =>
      invoice.amount === transaction.amount &&
      isDueNearTransaction(transaction.date, invoice.due_date),
  );

  if (candidates.length === 0) {
    return { kind: MatchKind.None };
  }
  if (candidates.length === 1) {
    return { kind: MatchKind.Matched, invoice: candidates[0] };
  }

  const named = candidates.filter((invoice) => labelNamesInvoice(transaction, invoice));
  if (named.length === 1) {
    return { kind: MatchKind.Matched, invoice: named[0] };
  }
  return { kind: MatchKind.Ambiguous, candidate_ids: candidates.map((invoice) => invoice.id) };
}
