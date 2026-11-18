-- Money must be exact: real is an approximate type (512.83 + 102.57 is not 615.40).
-- The value goes through text: a direct real to numeric cast keeps 6 digits (12345.67 becomes 12345.70).
alter table transaction
  alter column amount type numeric(28, 2) using amount::text::numeric(28, 2),
  alter column amount set not null;

alter table buying_invoice
  alter column tax_free_total type numeric(28, 2) using tax_free_total::text::numeric(28, 2),
  alter column vat_amount type numeric(28, 2) using vat_amount::text::numeric(28, 2),
  alter column due_date type date using due_date::date,
  alter column tax_free_total set not null,
  alter column vat_amount set not null;

-- Statuses come from a fixed list instead of free text.
alter table transaction drop constraint if exists transaction_status_check;
alter table transaction
  add constraint transaction_status_check check (status in ('Booked', 'Pending'));

alter table buying_invoice drop constraint if exists buying_invoice_status_check;
alter table buying_invoice
  add constraint buying_invoice_status_check
  check (invoice_status in ('Pending', 'ToPay', 'Paid', 'Cancelled'));

-- An invoice can be matched by at most one transaction that is not deleted.
create unique index if not exists transaction_matched_invoice_unique
  on transaction (matched_invoice_id)
  where matched_invoice_id is not null and deleted_at is null;

-- The job reads the invoices of a company and the transactions of an account.
create index if not exists buying_invoice_company_id_idx on buying_invoice (company_id);
create index if not exists transaction_account_id_idx on transaction (account_id);
