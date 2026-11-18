import { Outcome } from './matchAll';
import { MatchKind } from './matchKind';

export type Run = { siren: string; run_at: Date };

const count = (outcomes: Outcome[], kind: MatchKind) =>
  outcomes.filter((outcome) => outcome.kind === kind).length;

// One line for the console.
export function formatSummary(outcomes: Outcome[]): string {
  return (
    `Matched ${count(outcomes, MatchKind.Matched)} of ${outcomes.length} transactions: ` +
    `${count(outcomes, MatchKind.Ambiguous)} ambiguous, ${count(outcomes, MatchKind.Conflict)} in conflict, ` +
    `${count(outcomes, MatchKind.None)} without candidate`
  );
}

// The cases a person has to look at. A transaction without candidate is normal, so it is not listed.
function problemLines(outcomes: Outcome[]): string[] {
  const lines: string[] = [];
  const conflicts = new Map<string, string[]>();
  for (const outcome of outcomes) {
    if (outcome.kind === MatchKind.Ambiguous) {
      const { id, date, amount, label } = outcome.transaction;
      lines.push(
        `ambiguous: transaction ${id} (${date}, ${amount}, "${label}") fits invoices ${outcome.candidate_ids.join(', ')}`,
      );
    }
    if (outcome.kind === MatchKind.Conflict) {
      conflicts.set(outcome.invoice_id, outcome.transaction_ids);
    }
  }
  for (const [invoiceId, transactionIds] of conflicts) {
    lines.push(`conflict: invoice ${invoiceId} is wanted by transactions ${transactionIds.join(', ')}`);
  }
  return lines;
}

function header(run: Run, status: string): string[] {
  return [
    'Auto-matching report',
    `Company: ${run.siren}`,
    `Run at: ${run.run_at.toISOString()}`,
    `Status: ${status}`,
  ];
}

// The whole report of a run that went through: the counts, then the problems.
export function formatReport(outcomes: Outcome[], run: Run): string[] {
  const problems = problemLines(outcomes);
  return [
    ...header(run, 'completed'),
    '',
    `Processed: ${outcomes.length} transactions`,
    `Matched: ${count(outcomes, MatchKind.Matched)}`,
    `Ambiguous: ${count(outcomes, MatchKind.Ambiguous)}`,
    `Conflict: ${count(outcomes, MatchKind.Conflict)}`,
    `No candidate: ${count(outcomes, MatchKind.None)}`,
    '',
    `Problems to look at (${problems.length}):`,
    ...problems,
  ];
}

// The report of a run that stopped: the database transaction was rolled back.
export function formatFailure(error: unknown, run: Run): string[] {
  const message = error instanceof Error ? error.message : String(error);
  return [...header(run, 'FAILED, nothing was saved'), '', `Error: ${message}`];
}
