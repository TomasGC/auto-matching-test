import { describe, expect, it } from 'vitest';
import { DUE_DAYS_AFTER_TRANSACTION, DUE_DAYS_BEFORE_TRANSACTION, isDueNearTransaction } from './dates';

describe('isDueNearTransaction', () => {
  it('accepts a due date on the transaction date', () => {
    expect(isDueNearTransaction('2024-06-15', '2024-06-15')).toBe(true);
  });

  it('accepts the window limits and refuses one day beyond', () => {
    expect(DUE_DAYS_BEFORE_TRANSACTION).toBe(3);
    expect(DUE_DAYS_AFTER_TRANSACTION).toBe(30);

    expect(isDueNearTransaction('2024-06-15', '2024-06-12')).toBe(true);
    expect(isDueNearTransaction('2024-06-15', '2024-06-11')).toBe(false);
    expect(isDueNearTransaction('2024-06-15', '2024-07-15')).toBe(true);
    expect(isDueNearTransaction('2024-06-15', '2024-07-16')).toBe(false);
  });

  it('counts whole days across the daylight saving change (2024-03-31 in France)', () => {
    expect(isDueNearTransaction('2024-03-30', '2024-04-29')).toBe(true);
    expect(isDueNearTransaction('2024-03-30', '2024-04-30')).toBe(false);
    expect(isDueNearTransaction('2024-03-31', '2024-03-28')).toBe(true);
    expect(isDueNearTransaction('2024-03-31', '2024-03-27')).toBe(false);
  });

  it('counts the 29th of February of a leap year', () => {
    expect(isDueNearTransaction('2024-02-15', '2024-03-16')).toBe(true);
    expect(isDueNearTransaction('2024-02-15', '2024-03-17')).toBe(false);
  });

  it('counts across a change of year', () => {
    expect(isDueNearTransaction('2023-12-20', '2024-01-19')).toBe(true);
    expect(isDueNearTransaction('2023-12-20', '2024-01-20')).toBe(false);
  });
});
