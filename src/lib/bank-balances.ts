/** One definition of "what this account is worth right now", shared by the
 *  Bank Accounts page, the Credit Cards page and every CFO surface, so the
 *  same account can never show two different numbers.
 *
 *  - depository: available balance as the bank reports it
 *  - credit: what the bank reports as owed = |ledger balance|. The old CFO
 *    formula (credit limit − available) drifted whenever the feed's limit was
 *    stale or the card was over limit — ··1022 read $58k owed against a real
 *    $2.7k. Limit − available is only the fallback when no ledger exists. */

export interface BalanceRow {
  account_type: string;
  balance_available_cents: number | null;
  balance_ledger_cents: number | null;
  credit_limit_cents?: number | null;
}

export function cardOwedCents(a: BalanceRow): number {
  if (a.balance_ledger_cents != null) return Math.abs(a.balance_ledger_cents);
  const limit = a.credit_limit_cents || 0;
  return Math.max(0, limit - (a.balance_available_cents || 0));
}

export function cashAvailableCents(a: BalanceRow): number {
  return a.balance_available_cents || 0;
}

/** Signed contribution to a balance sheet: cash positive, card debt negative. */
export function netContributionCents(a: BalanceRow): number {
  return a.account_type === 'credit' ? -cardOwedCents(a) : cashAvailableCents(a);
}
