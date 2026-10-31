/**
 * DeepSeek official account balance for the footer board header.
 *
 * The DSH desktop shell keeps the signed-in official account's wallet on the
 * host (`deepseekAccount.getBalance`). The browser reaches the same value
 * through the native `remote.account.getBalance` method, so this plugin never
 * touches a token and needs no host-side balance endpoint. The response is
 * normalized to one total per the wallet rule used by the built-in account
 * page: topped-up + granted wallets, CNY preferred when several currencies
 * exist, malformed wallet rows ignored as a whole.
 *
 * @module dsh-account-model-hub/deepseek-balance
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Normalized official-account balance. */
export interface DeepSeekBalance {
  /** Upper-case ISO currency (`CNY` / `USD`). */
  currency: string
  /** Topped-up + granted total. */
  total: number
  /** Granted (bonus) wallets only. */
  granted: number
  /** Topped-up wallets only. */
  toppedUp: number
}

/** One raw wallet row from the account service. */
interface RawWallet {
  currency?: unknown
  balance?: unknown
}

/** The account service's balance details. */
interface RawBalanceDetails {
  status?: unknown
  value?: unknown
  bonusWallets?: unknown
}

/** Parse one wallet list; any malformed row rejects the whole list. */
function walletsOf(raw: unknown): { currency: string; amount: number }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const result: { currency: string; amount: number }[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') return undefined
    const wallet = entry as RawWallet
    const currency = typeof wallet.currency === 'string' ? wallet.currency.toUpperCase() : ''
    const text = typeof wallet.balance === 'string' ? wallet.balance.trim() : ''
    const amount = typeof wallet.balance === 'number' ? wallet.balance : Number(text)
    if (!['CNY', 'USD'].includes(currency) || !Number.isFinite(amount)) return undefined
    result.push({ currency, amount })
  }
  return result
}

/**
 * Normalize one `account.getBalance` result into the footer's total.
 * @param details - raw balance details (`{status, value, bonusWallets}`).
 * @returns the normalized total, or undefined when the account is signed out/failed.
 */
export function normalizeDeepSeekBalance(details: unknown): DeepSeekBalance | undefined {
  if (details === null || typeof details !== 'object') return undefined
  const record = details as RawBalanceDetails
  if (record.status !== 'ready') return undefined
  const normal = walletsOf(record.value)
  const bonus = walletsOf(record.bonusWallets)
  if (normal === undefined || bonus === undefined) return undefined
  const totals = new Map<string, number>()
  for (const wallet of [...normal, ...bonus]) {
    totals.set(wallet.currency, (totals.get(wallet.currency) ?? 0) + wallet.amount)
  }
  const currency = totals.has('CNY') ? 'CNY' : [...totals.keys()][0]
  if (currency === undefined) return undefined
  const sum = (list: { currency: string; amount: number }[]): number =>
    list.filter(wallet => wallet.currency === currency).reduce((acc, wallet) => acc + wallet.amount, 0)
  const toppedUp = sum(normal)
  const granted = sum(bonus)
  return {
    currency,
    total: toppedUp + granted,
    granted,
    toppedUp,
  }
}

/** Currency symbol used by the compact header line. */
export function balanceSymbol(currency: string): string {
  return currency === 'USD' ? '$' : '¥'
}

/** The native Remote account method shape (typed loosely: this plugin owns no host contract). */
interface RemoteAccountBalance {
  account?: {
    getBalance?: (
      metadata: { version: string; locale: string; timezoneOffsetSeconds: number },
    ) => Promise<{ ok: boolean; value?: unknown }>
  }
}

/**
 * Build a loader that reads the signed-in official account's balance through
 * the shell's native Remote namespace.
 * @param ctx - client root context.
 * @returns an async loader; resolves undefined when unavailable/not signed in.
 */
export function createDeepSeekBalanceLoader(
  ctx: ClientContext,
): () => Promise<DeepSeekBalance | undefined> {
  return async () => {
    let remote: RemoteAccountBalance | undefined
    try {
      remote = ctx.get('remote') as RemoteAccountBalance | undefined
    } catch {
      // The namespace service below is the fallback for shells that expose it directly.
    }
    let account = remote?.account
    if (account === undefined) {
      try {
        account = ctx.get('remote.account') as RemoteAccountBalance['account']
      } catch {
        return undefined
      }
    }
    const getBalance = account?.getBalance
    if (account === undefined || typeof getBalance !== 'function') return undefined
    const release = (globalThis as typeof globalThis & {
      __DSH_BOOT__?: { release?: { version?: unknown } }
    }).__DSH_BOOT__?.release
    const version = typeof release?.version === 'string' ? release.version : ''
    let locale = 'en'
    try {
      locale = ctx.locale.getSnapshot().active
    } catch {
      // The locale service is optional during early boot; the host accepts en.
    }
    try {
      const result = await getBalance.call(account, {
        version,
        locale,
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      })
      if (result.ok !== true) return undefined
      return normalizeDeepSeekBalance(result.value)
    } catch {
      return undefined
    }
  }
}
