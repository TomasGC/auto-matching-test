import { MatchKind } from './matchKind';

export type Transaction = {
  id: string;
  amount: string; // the amount paid out, always positive
  label: string;
  date: string; // YYYY-MM-DD
};

export type Invoice = {
  id: string;
  supplier_name: string | null;
  invoice_number: string | null;
  amount: string; // tax free total + VAT
  due_date: string; // YYYY-MM-DD
};

export type MatchResult =
  | { kind: MatchKind.Matched; invoice: Invoice }
  | { kind: MatchKind.Ambiguous; candidate_ids: string[] }
  | { kind: MatchKind.None };
