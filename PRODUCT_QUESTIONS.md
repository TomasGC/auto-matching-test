# Product questions

Decisions the code cannot make alone. Each one says what the job does today, so a wrong default is easy to spot and change.

## 1. Which invoices can be matched?

- Today: invoices in `Pending` or `ToPay`. `Paid`, `Cancelled` and deleted ones are never matched.
- Question: what does `Pending` mean (draft, waiting for approval)? If an invoice is not approved yet, a payment should probably not be matched to it.
- Impact: removing `Pending` from the list is one constant (`MATCHABLE_INVOICE_STATUSES`).

## 2. Is one candidate enough?

- Today: if exactly one invoice fits the amount and the due-date window, it is matched, even if the label says nothing about it.
- Question: is this acceptable, or must the label always name the supplier or the invoice number?
- Impact: it is the main source of automation, and also the main remaining risk of a wrong match (same amount and date by coincidence).

## 3. What to do with recurring invoices?

- Today: when several invoices of the same supplier have the same amount inside the window (Orange, Atlassian, Google Cloud), the transaction is left ambiguous. On the seed, 187 of 983 eligible transactions end this way. In 182 of them all the candidates come from one supplier, and in 146 the label also names that supplier.
- Question: is it acceptable to take the invoice whose due date is closest to the transaction date when all candidates come from the same supplier and the label names it?
- Impact: more automatic matches, but a risk of choosing the wrong month.

## 4. Where do ambiguous and conflicting cases go?

- Today: each run writes them in a report file (`reports/`), with the transaction and the invoices involved. Nothing is stored in the database.
- Question: who handles them, and in which tool? A review queue needs a place to persist them (table or status) and a way for a person to confirm or reject.

## 5. What is the right due-date window?

- Today: from 3 days before to 30 days after the transaction date, as the README says (constants in `src/matching/dates.ts`).
- Question: do these values match how suppliers are really paid? They should be checked against real data, per company if payment terms differ.

## 6. Should the job change the invoice status?

- Today: it only sets `matched_invoice_id` on the transaction. The invoice stays `Pending` or `ToPay`.
- Question: should a match move the invoice to `Paid`?
- Related: a `Paying` status (payment sent, not yet booked) would allow provisional matching of `Pending` bank transactions. It needs bank callbacks, and latency and behaviour differ per bank, so it is probably not worth it for now.

## 7. What about payments that are not one-to-one?

- Today: one transaction matches one invoice, for the exact total (tax free total + VAT).
- Not handled: partial payments, one transfer paying several invoices, credit notes, bank fees or rounding differences.
- Question: which of these happen often enough to deserve a rule?

## 8. How is a wrong match corrected?

- Today: nothing. A match is written and never revisited.
- Question: can a person remove a match, and should the job then leave that pair alone next time?

## 9. Which currencies?

- Today: the schema has no currency column. Amounts are `numeric(28,2)`, which fits euros only.
- Question: will other currencies be supported?
- Impact: yes means a currency column on both tables, a wider scale (for example `numeric(28,8)`), and a match that also compares the currency.
