/** Detect gateway / provider errors that mean the account has no spendable credit. */
const BALANCE_ERROR_RE = /insufficient(?:[_ ]account)?[_ ]balance|insufficient_quota|quota[_ ]exceeded|exceeded your current quota|payment required|top_up_balance|\(402\)|余额不足|余额或额度不足/i;

export function isInsufficientBalanceError(message: string | null | undefined): boolean {
  return typeof message === 'string' && BALANCE_ERROR_RE.test(message);
}
