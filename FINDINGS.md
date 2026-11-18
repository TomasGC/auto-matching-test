# Findings

Ranking: the README says a wrong match is worse than no match. Points that can write a wrong match come first, then silent misses, then robustness and cost.

Method: I read `src/matcher.ts` and ran the job on the seed (`npm run db:reset && npm start`): 508 of 1200 transactions matched in 49 seconds.
The examples come from that run, and `seed.sql line N` refers to `seeds/seed.sql`.

## 1. A match is always forced

Method: `findMatch`

Excerpt:
```ts
scored.sort((a, b) => a.score - b.score);
return scored[0].invoice;
```

Issue: The first candidate is always taken, even when several are equally good. The README says that without a convincing candidate the transaction stays unmatched, but the code never does that once there is at least one candidate.

Consequence: A guess is written as a certain match which can lead to a possibly wrong accounting record that nobody will check.

Example: "PRLV SEPA FACT 0512" (amount = -240, `seed.sql` line 35636) goes to Bureau Vallée (line 3902), while the Lyreco invoice (line 5850) has the same amount and the same due date.

Proposal: Match only when one candidate clearly wins, otherwise leave the transaction for a human to check.

## 2. Wrong supplier matched

Method: `scoreCandidate`

Excerpt:
```ts
label.includes(normalizeLabel(invoice.supplier_name))
```

Issue: The supplier name is looked for anywhere in the label, even inside another word.

Consequence: The payment is booked on another supplier's invoice, and the right invoice stays unpaid.

Example: The transaction "VIR TRANSFERT SFRI SARL" (amount = -89.99, `seed.sql` line 35776) fits two invoices with the same amount: "SFR" (line 9748) and "SFRI SARL" (line 11697). Both names are found in the label ("sfr" is inside "sfri"), so both get the 100 bonus points, and only the due date decides. The SFR invoice is due closer to the payment date, so it wins, while the right supplier is SFRI SARL.

Proposal: Compare whole words only, not pieces of words.

## 3. Empty invoice number

Method: `scoreCandidate`

Excerpt:
```ts
label.includes(normalizeLabel(invoice.invoice_number))
```

Issue: An empty text is contained in every label, so an invoice without a number always gets the 100 bonus points.

Consequence: A payment is booked on the invoice of an unrelated supplier, only because that invoice has no number.

Example: The transaction "PRLV SEPA SAGE" (amount = -129, `seed.sql` line 36628) is attached to the Qonto invoice (line 33142, empty number) instead of the Sage SAS invoice (line 31192). Both invoices have the same amount.

Proposal: Ignore the invoice number when it is empty.

## 4. One invoice matched by several transactions

Methods: `runAutoMatching`, `getCandidates`

Excerpt:
```ts
`select transaction.* from transaction join account on account.id = transaction.account_id where account.company_id = '${company.id}'`
`select * from buying_invoice where company_id = '${companyId}'`
```

Issue: Nothing excludes an invoice that is already used, nor a transaction that is already matched. One invoice can be matched to several transactions, and an existing match can be overwritten.

Consequence: An invoice is shown as paid twice, a bank duplicate is booked twice, and an earlier match can be silently replaced.

Example:
- Two "PRLV SEPA OVH SAS" transactions of amount = -360 (`seed.sql` lines 35846 and 35917, one day apart) fit the same OVH invoice of 360 (300 excluding tax and 60 of VAT, line 13646). Nothing remembers that the invoice is already used, so both end on it (the first transaction already pointed at it in the seed).
- Two rent transactions of amount = -1500 with the same `remote_id` (lines 36413 and 36484, so probably the same bank movement imported twice) both end on the same rent invoice (line 27292). The duplicate is not detected.

After the test run, 13 invoices are used by several transactions.

Proposal: Only take transactions not yet matched, and invoices not yet used.

## 5. Incoming money matched to supplier invoices

Methods: `runAutoMatching`, `findMatch`

Excerpt:
```ts
Math.abs(transaction.amount)
```

Issue: The README says the job handles outgoing transactions only, but the sign of the amount is thrown away and nothing filters the direction.

Consequence: A customer payment is booked as the payment of a supplier invoice.

Example: "VIR RECU CLIENT DUPONT" (amount = +450, `seed.sql` line 36200) is matched with the Imprimerie Dupont invoice (line 21443). In total, 8 incoming transactions are matched.

Proposal: Only take transactions with a negative amount.

## 6. Deleted, cancelled and paid invoices matched

Method: `getCandidates`

Excerpt:
```ts
`select * from buying_invoice where company_id = '${companyId}'`
```

Issue: Every invoice of the company is a candidate, whatever its state, although we have `deleted_at` and `invoice_status`. The same happens with transactions, because `status` and `deleted_at` are not checked either.

Consequence: A payment is booked on an invoice that should no longer exist, or that is already settled.

Example: "PRLV SEPA WELCOME TO THE JUNGLE" (`seed.sql` line 36271) is matched with a deleted invoice (line 23392), and "PRLV SEPA ADOBE SYSTEMS" (line 36129) with an already paid one (line 19493). In total, 12 matches were made on deleted invoices, 29 on cancelled ones and 150 on paid ones.

Proposal: Keep only active invoices and transactions, and decide with the product side which statuses can still be matched. Allow only a fixed list of values in `status` and `invoice_status`: today any spelling is accepted ("Booked" and "booked" would be two statuses).

## 7. Errors swallowed

Method: `runAutoMatching`

Excerpt:
```ts
} catch (e) {
  console.log("skip", e);
}
```

Issue: When a transaction fails, the error is only printed and the job ends normally. The failure comes from `normalizeLabel`, which crashes on an empty (NULL) value.

Consequence: A transaction disappears from the result with no trace, and the job still looks successful.

Example: The transaction "PRLV SEPA ASSURANCE" (`seed.sql` line 36556) crashed in the test run, because its invoice (line 29242) has no supplier name. It was silently dropped.

Proposal: Count the failures, show them at the end, and make the job fail when there is one.

## 8. Amounts compared as floats

Method: `findMatch`

Excerpt:
```ts
invoice.tax_free_total + invoice.vat_amount === Math.abs(transaction.amount)
```

Issue: Decimal amounts are not exact in JavaScript, so a sum that is right on paper can be different from the transaction amount. The database does not help: the columns are `real`, an approximate type (about 7 digits), and above about 131000 the cents are not even guaranteed (not seen in the seed, where amounts stay under 5000).

Consequence: The payment stays unmatched, and the customer has to do it by hand, with no warning.

Example: The Cabinet Bernard Conseil invoice (`seed.sql` line 7799) has tax_free_total = 512.83 and vat_amount = 102.57, and its transaction (line 35706) has amount = -615.4. On paper it matches, but 512.83 + 102.57 gives 615.4000000000001 in JavaScript, so the payment is never matched.

Proposal: Store the amounts as exact decimals with 2 decimals, add the tax free total and the VAT in the database, and compare the result as it is.

## 9. Due date stored as text

Field: `due_date` is a varchar

Issue: A date stored as text has no guaranteed format, and can be empty.

Consequence: An invoice without a due date can never be matched.

Example: The transaction "VIR ACME CONSULTING" (`seed.sql` line 35987) is never matched, because its invoice (line 15595) has no due date. In total, 1051 invoices have none.

Proposal: Use a real date type, and decide what to do when it is missing.

## 10. No transaction, no protection against concurrent runs

Method: `runAutoMatching`

Excerpt:
```ts
`update transaction set matched_invoice_id = '${invoice.id}' where id = '${transaction.id}'`
```

Issue: Each update is saved on its own. If the job stops in the middle, only part of the matches are written, and two runs at the same time can overwrite each other.

Consequence: A stopped or duplicated run leaves the matches half written, with no way to tell which.

Proposal: Do the whole run in one database transaction, and forbid two runs at the same time.

## 11. One full query per transaction

Method: `runAutoMatching`

Excerpt:
```ts
const invoice = findMatch(transaction, await getCandidates(company.id));
```

Issue: All the invoices of the company are loaded again for every transaction. The time grows with both the number of transactions and the number of invoices.

Consequence: The job becomes too slow as the data grows.

Example: With 1200 transactions and about 35000 invoices, the job takes 49 seconds.

Proposal: Load the invoices once, or let the database pick the right ones, and add an index.

## 12. SQL built by string concatenation

Method: `getCandidates`

Excerpt:
```ts
`select * from buying_invoice where company_id = '${companyId}'`
```

Method: `runAutoMatching`

Excerpt:
```ts
`select * from company where siren = '${companySiren}'`
```

Issue: Values are pasted directly into the SQL text (SQL injection). Today they come from `main.ts` and from the database, so there is no known exploit. The same is done in the other queries of the file.

Consequence: A future caller passing user input could read or change any data.

Proposal: Pass values as query parameters, and stop with a clear message when the company is not found.

## Final note

The new job is in `src/matching/`, with its tests next to it. It follows one rule: a wrong match is worse than no match, so when the answer is not clear, it leaves the transaction to a person.

### What I left undone

Not built:

- **Review of the unclear cases.** Each run writes them in a report file (187 of 983 eligible transactions on the seed), but nothing is stored in the database and a person cannot confirm or reject them.
- **Invoice status update.** After a match, the invoice stays `Pending` or `ToPay`.
- **Undo of a match.**
- **Payments that are not one to one.** Partial payments, grouped payments, credit notes and bank fees stay unmatched.
- **Pending bank transactions.** They are ignored until they are booked.
- **Other currencies.** Euros only, there is no currency column.

Left out on purpose:

- **Foreign key on `matched_invoice_id`.** I only added a unique index. A foreign key would need to be deferred to load the seed in any order, and it would reject a seed with matches that point to no invoice. The job does not need it to stay correct.

Not verified:

- **Due-date window.** The rule of the README is applied and its edges are tested. Whether these values fit real payments cannot be checked on the seed (amounts repeat across the whole year).

### What I need from the product side

The full list, with what the job does today for each point, is in `PRODUCT_QUESTIONS.md`. The four that change results the most:

- Is one candidate enough, even when the label says nothing about it? (question 2)
- What to do with recurring invoices of the same supplier and amount: leave them to a person, or take the closest due date? (question 3)
- Can `Pending` invoices be matched, and what does `Pending` mean? (question 1)
- Which due-date window matches how suppliers are really paid? (question 5)

### What I would build next

Doable now without waiting for the product side:

1. A table for the cases left to a person (transaction, candidate invoices, reason, status), instead of the report file, with a way to confirm or reject, and to undo a match.
2. A trace on every match: when, by which run, and why (named in the label, or the only candidate).

After the product side has answered (see `PRODUCT_QUESTIONS.md`):

3. The rule for recurring invoices.
4. The invoice status update after a match, and the matching of `Pending` bank transactions.
5. Partial and grouped payments, then other currencies (a currency column, a wider scale, and a match that also compares the currency).
