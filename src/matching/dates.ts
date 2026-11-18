const MS_PER_DAY = 86_400_000;

// An invoice can match a payment when it falls due from 3 days before to 30 days after the transaction date.
export const DUE_DAYS_BEFORE_TRANSACTION = 3;
export const DUE_DAYS_AFTER_TRANSACTION = 30;

// Days are counted on UTC midnights, so the result never depends on the machine timezone.
function toUtcDay(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

export function isDueNearTransaction(transactionDate: string, dueDate: string): boolean {
  const daysToDueDate = toUtcDay(dueDate) - toUtcDay(transactionDate);
  return daysToDueDate >= -DUE_DAYS_BEFORE_TRANSACTION && daysToDueDate <= DUE_DAYS_AFTER_TRANSACTION;
}
