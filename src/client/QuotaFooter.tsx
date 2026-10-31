/**
 * Sidebar footer quota board: one compact rounded card, transposed layout —
 * rows are providers (GPT / OpenCode Go / Claude), columns are the fixed time
 * windows (5h / weekly / monthly). Each cell shows the REMAINING percentage
 * with a small unified-colour bar; windows a provider does not report show a
 * muted "—" and draw no bar, so columns stay aligned without blank rows.
 *
 * A single status line under the grid shows the reset time of the earliest
 * window by default; hovering any cell swaps it to that provider/window's
 * reset (no click). The card follows the account the pool served most recently
 * (`activeAccount`) and is fed by `status` + `usage` on a 60s poll.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { callSubscriptionsAuth } from './SubscriptionsSection.js'
import type {
  AccountStatus,
  ProviderStatus,
  ProviderUsage,
  SubscriptionProvider,
  UsageWindow,
} from './SubscriptionsSection.js'
import {
  QUOTA_LAYERS,
  formatQuotaReset,
  quotaWindowsByLayer,
  remainingPercent,
} from './quota-model.js'
import type { QuotaLayerSpec } from './quota-model.js'
import { en } from './locales.js'
import type { SubscriptionsKey } from './locales.js'
import { balanceSymbol } from './deepseek-balance.js'
import type { DeepSeekBalance } from './deepseek-balance.js'
import { ProviderPoolDialog } from './ProviderPoolDialog.js'
import type { PoolDialogProvider } from './ProviderPoolDialog.js'

/** How often the board re-reads status + usage; the host also caches usage for 60s. */
const POLL_INTERVAL_MS = 60_000

/** Official account balance changes slowly; five minutes matches the old footer card. */
const BALANCE_POLL_INTERVAL_MS = 5 * 60_000

/** One shared bar colour for every time window (user request). */
const BAR_COLOR = '#6aa9ff'

/** Grid columns: identity column + three window columns. */
const BOARD_GRID = '70px repeat(3, minmax(0, 1fr))'

/** The three provider rows, in display order. */
const CARDS: readonly { id: SubscriptionProvider; title: string; short: string }[] = [
  { id: 'codex', title: 'GPT (Codex)', short: 'GPT' },
  { id: 'opencode-go-hub', title: 'OpenCode Go', short: 'OpenCode' },
  { id: 'claude', title: 'Claude', short: 'Claude' },
]

/** `status` endpoint value (subset this component needs). */
interface StatusResponse {
  providers: Partial<Record<SubscriptionProvider, ProviderStatus>>
}

/** Injected dependencies (slot `inject`, root-scope). */
export interface QuotaFooterInjected {
  /** Connection RPC caller to reach the `subscriptions-auth` endpoints. */
  rpc: ConnectionHandle['rpc']
  /** Native DeepSeek official-account balance reader (undefined when unavailable). */
  loadBalance?: () => Promise<DeepSeekBalance | undefined>
}

/** One account's usage lookup result while assembling a row. */
interface AccountUsage {
  account: AccountStatus
  usage?: ProviderUsage
  error?: string
}

/** One rendered provider row. */
interface CardState {
  def: { id: SubscriptionProvider; title: string; short: string }
  /** Number of connected accounts; `undefined` means "not loaded yet". */
  accountCount?: number
  /** Display label of the account whose usage is shown. */
  accountLabel?: string
  /** Plan name reported by the session or usage endpoint. */
  plan?: string
  usage?: ProviderUsage
  error?: string
}

/** Hovered cell, kept in the board so one shared status line can follow it. */
interface HoveredCell {
  provider: string
  spec: QuotaLayerSpec
  window: UsageWindow
}

/** Props delivered by the slot outlet + inject + the locale seat. */
export type QuotaFooterProps = PropsRuntime<'sidebar.footer.action'>
  & Partial<QuotaFooterInjected>
  & Partial<PropsLocale<'settings.subscriptions'>>

/** Translate without a mounted locale service (tests / early boot). */
function fallbackT(key: SubscriptionsKey, params?: Record<string, unknown>): string {
  let text: string = en[key] ?? key
  for (const [name, value] of Object.entries(params ?? {})) {
    text = text.replaceAll(`{${name}}`, String(value))
  }
  return text
}

/** Human text of a failure. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The account whose quota the row should show. The pool's last served account
 * wins (`activeAccount`); then the default account for direct routes; for
 * multi-account OpenCode Go without a recorded active member, the least-limited
 * account (matching quota-aware selection).
 */
function chooseAccount(
  provider: SubscriptionProvider,
  entries: readonly AccountUsage[],
  activeAccount: string | undefined,
  preferredAccount: string | undefined,
): AccountUsage | undefined {
  if (entries.length === 0) return undefined
  // A manual pin is what the user expects to see immediately; the active
  // account is only the fallback when automatic scheduling is in charge.
  if (preferredAccount !== undefined) {
    const pinned = entries.find(entry => entry.account.key === preferredAccount)
    if (pinned !== undefined) return pinned
  }
  if (activeAccount !== undefined) {
    const active = entries.find(entry => entry.account.key === activeAccount)
    if (active !== undefined) return active
  }
  const reported = entries.filter(entry => entry.usage !== undefined)
  if (reported.length === 0) return entries.find(entry => entry.account.isDefault) ?? entries[0]
  if (provider === 'opencode-go-hub' && reported.length > 1) {
    const score = (entry: AccountUsage): number =>
      Math.min(...(entry.usage?.windows ?? []).map(window => remainingPercent(window)))
    return reported.reduce((best, entry) => score(entry) > score(best) ? entry : best)
  }
  return reported.find(entry => entry.account.isDefault) ?? reported[0]
}

/** Inline styles for the compact board. */
const styles: Record<string, CSSProperties> = {
  board: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    width: '100%',
    boxSizing: 'border-box',
    border: '0.5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4))',
    borderRadius: 'var(--dsw-radius-lg, 16px)',
    background: 'var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2))',
    padding: '6px 8px 5px',
    color: 'var(--dsw-alias-label-primary)',
  },
  headerRow: {
    display: 'grid',
    gridTemplateColumns: BOARD_GRID,
    alignItems: 'center',
    minHeight: 15,
    borderBottom: '0.5px solid var(--dsw-alias-border-l2)',
    paddingBottom: 1,
  },
  headerLabel: {
    fontSize: 9,
    lineHeight: '11px',
    color: 'var(--dsw-alias-label-tertiary)',
    textAlign: 'center',
    whiteSpace: 'nowrap',
  },
  balance: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 8.5,
    lineHeight: '11px',
    color: 'var(--dsw-alias-label-tertiary)',
    fontVariantNumeric: 'tabular-nums',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: BOARD_GRID,
    alignItems: 'center',
    minHeight: 30,
    padding: '2px 0',
    boxSizing: 'border-box',
  },
  rowDivider: { borderBottom: '0.5px solid var(--dsw-alias-border-l2)' },
  identity: { display: 'flex', flexDirection: 'column', minWidth: 0, paddingRight: 4 },
  identityButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    minWidth: 0,
    margin: 0,
    padding: '1px 4px 1px 0',
    border: 0,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    borderRadius: 4,
  },
  titleRow: { display: 'flex', alignItems: 'center', gap: 2, minWidth: 0 },
  provider: {
    fontSize: 10.5,
    lineHeight: '13px',
    fontWeight: 600,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  count: {
    fontSize: 8.5,
    lineHeight: '11px',
    color: 'var(--dsw-alias-label-tertiary)',
    flexShrink: 0,
  },
  account: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 8.5,
    lineHeight: '11px',
    color: 'var(--dsw-alias-label-tertiary)',
  },
  cell: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 2,
    minWidth: 0,
    borderRadius: 3,
    padding: '0 2px',
  },
  cellHovered: { background: 'rgba(148, 163, 184, 0.10)' },
  value: {
    fontSize: 12,
    lineHeight: '14px',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
  },
  missing: {
    fontSize: 11,
    lineHeight: '14px',
    color: 'var(--dsw-alias-label-dimmed)',
  },
  track: {
    height: 3,
    width: '100%',
    borderRadius: 1.5,
    overflow: 'hidden',
    background: 'rgba(148, 163, 184, 0.22)',
  },
  fill: { height: '100%', borderRadius: 1.5, background: BAR_COLOR, transition: 'width 160ms ease' },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    minHeight: 13,
    borderTop: '0.5px solid var(--dsw-alias-border-l2)',
    paddingTop: 1,
    minWidth: 0,
  },
  statusDot: { width: 5, height: 5, borderRadius: '50%', flexShrink: 0, background: BAR_COLOR },
  statusText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 8.5,
    lineHeight: '11px',
    color: 'var(--dsw-alias-label-tertiary)',
  },
  topError: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-state-error-primary)' },
}

/** One window cell: remaining percentage + unified bar, or a muted em dash. */
function QuotaCell({
  provider,
  spec,
  window,
  hovered,
  onHover,
  t,
}: {
  provider: string
  spec: QuotaLayerSpec
  window: UsageWindow | undefined
  hovered: boolean
  onHover: (cell: HoveredCell) => void
  t: (key: SubscriptionsKey, params?: Record<string, unknown>) => string
}) {
  if (window === undefined) {
    return <div style={styles.cell} aria-hidden="true"><span style={styles.missing}>—</span></div>
  }
  const remaining = remainingPercent(window)
  const reset = window.resetsAt
  const title = [
    provider,
    t(spec.labelKey),
    `${Math.round(remaining)}%`,
    ...reset === undefined ? [] : [`${t('quotaReset')} ${formatQuotaReset(reset)}`],
  ].join(' · ')
  return (
    <div
      style={{ ...styles.cell, ...hovered ? styles.cellHovered : {} }}
      title={title}
      onPointerEnter={() => onHover({ provider, spec, window })}
    >
      <span style={{
        ...styles.value,
        ...remaining < 15 ? { color: 'var(--dsw-alias-state-warn-label)' } : {},
      }}>{Math.round(remaining)}%</span>
      <span style={styles.track}>
        <span style={{ ...styles.fill, display: 'block', width: `${String(remaining)}%` }} />
      </span>
    </div>
  )
}

/** The window with the earliest upcoming reset (for the default status line). */
function earliestReset(cards: readonly CardState[]): HoveredCell | undefined {
  let best: HoveredCell | undefined
  for (const card of cards) {
    if (card.usage === undefined) continue
    const byLayer = quotaWindowsByLayer(card.usage.windows ?? [])
    for (const spec of QUOTA_LAYERS) {
      const window = byLayer.get(spec.id)
      if (window?.resetsAt === undefined) continue
      if (best === undefined || window.resetsAt < (best.window.resetsAt ?? Infinity)) {
        best = { provider: card.def.short, spec, window }
      }
    }
  }
  return best
}

/** The one shared status line under the grid. */
function statusText(
  card: HoveredCell | undefined,
  t: (key: SubscriptionsKey, params?: Record<string, unknown>) => string,
): string {
  if (card === undefined) return t('quotaNoWindows')
  const reset = card.window.resetsAt
  return reset === undefined
    ? `${card.provider} ${t(card.spec.labelKey)}`
    : `${card.provider} ${t(card.spec.labelKey)} · ${t('quotaReset')} ${formatQuotaReset(reset)}`
}

/**
 * The footer quota board. Polls `status` + per-account `usage` every minute,
 * pauses while the tab is hidden, and refreshes immediately when it becomes
 * visible again. Renders nothing on the collapsed rail.
 */
export function QuotaFooter(props: QuotaFooterProps) {
  const { rpc, wide, loadBalance } = props
  const t = props.t ?? fallbackT
  const [cards, setCards] = useState<readonly CardState[] | undefined>(undefined)
  const [balance, setBalance] = useState<DeepSeekBalance | undefined>(undefined)
  const [topError, setTopError] = useState<string | undefined>(undefined)
  const [hovered, setHovered] = useState<HoveredCell | undefined>(undefined)
  const [openProvider, setOpenProvider] = useState<PoolDialogProvider | undefined>(undefined)
  const mountedRef = useRef(true)
  const inflightRef = useRef(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (rpc === undefined || inflightRef.current) return
    inflightRef.current = true
    try {
      const status = await callSubscriptionsAuth<StatusResponse>(rpc, 'status', {})
      const next = await Promise.all(CARDS.map(async def => {
        const providerStatus = status.providers?.[def.id]
        const accounts = providerStatus?.accounts ?? []
        if (accounts.length === 0) {
          return { def, accountCount: 0 } satisfies CardState
        }
        const entries = await Promise.all(accounts.map(async (account): Promise<AccountUsage> => {
          try {
            const usage = await callSubscriptionsAuth<ProviderUsage>(rpc, 'usage', { provider: def.id, account: account.key })
            return { account, usage }
          } catch (error) {
            return { account, error: messageOf(error) }
          }
        }))
        const chosen = chooseAccount(def.id, entries, providerStatus?.activeAccount, providerStatus?.preferredAccount)
        if (chosen === undefined) return { def, accountCount: accounts.length } satisfies CardState
        const plan = chosen.usage?.plan ?? chosen.account.plan
        return {
          def,
          accountCount: accounts.length,
          ...chosen.account.account === undefined ? {} : { accountLabel: chosen.account.account },
          ...plan === undefined ? {} : { plan },
          ...chosen.usage === undefined ? {} : { usage: chosen.usage },
          ...chosen.usage === undefined && chosen.error !== undefined ? { error: chosen.error } : {},
        } satisfies CardState
      }))
      if (!mountedRef.current) return
      setCards(next)
      setTopError(undefined)
    } catch (error) {
      if (mountedRef.current) setTopError(messageOf(error))
    } finally {
      inflightRef.current = false
    }
  }, [rpc])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh()
    }, POLL_INTERVAL_MS)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mountedRef.current = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

  useEffect(() => {
    if (loadBalance === undefined) return
    let disposed = false
    const load = async (): Promise<void> => {
      try {
        const next = await loadBalance()
        if (!disposed) setBalance(next)
      } catch {
        // Balance is auxiliary: a failed lookup leaves the header line absent.
      }
    }
    void load()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void load()
    }, BALANCE_POLL_INTERVAL_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [loadBalance])

  if (wide === false) return null
  const shown: readonly CardState[] = cards ?? CARDS.map(def => ({ def }))
  const defaultCell = earliestReset(shown)
  const active = hovered ?? defaultCell
  const loading = cards === undefined
  return (
    <>
      {topError !== undefined && <div style={styles.topError} title={topError}>{t('quotaUsageError')}</div>}
      <div
        className="dsh-account-model-hub-quota-board"
        style={styles.board}
        aria-label={t('quotaFooterTitle')}
        onPointerLeave={() => setHovered(undefined)}
      >
        <div style={styles.headerRow}>
          <span style={styles.balance} title={
            balance === undefined
              ? undefined
              : `${t('quotaBalance')} ${balanceSymbol(balance.currency)}${balance.total.toFixed(2)}`
          }>
            {balance === undefined
              ? ''
              : `${t('quotaBalance')} ${balanceSymbol(balance.currency)}${balance.total.toFixed(2)}`}
          </span>
          {QUOTA_LAYERS.map(spec => (
            <span key={spec.id} style={styles.headerLabel}>{t(spec.shortLabelKey)}</span>
          ))}
        </div>
        {shown.map((card, index) => {
          const byLayer = quotaWindowsByLayer(card.usage?.windows ?? [])
          const connected = (card.accountCount ?? 0) > 0
          const accountText = card.accountLabel ?? (card.accountCount === 0 ? t('quotaNotLoggedIn') : '')
          return (
            <div key={card.def.id} style={{ ...styles.row, ...index < shown.length - 1 ? styles.rowDivider : {} }}>
              <button
                type="button"
                style={styles.identityButton}
                title={`${[card.def.title, card.accountLabel, card.plan].filter(Boolean).join('\n')}\n${t('poolDialogOpen')}`}
                aria-haspopup="dialog"
                onClick={() => setOpenProvider({ id: card.def.id, title: card.def.title, short: card.def.short })}
              >
                <div style={styles.titleRow}>
                  <span style={styles.provider}>{card.def.short}</span>
                  {card.accountCount !== undefined && card.accountCount > 1 && (
                    <span style={styles.count}>×{card.accountCount}</span>
                  )}
                </div>
                <span style={styles.account}>{accountText}</span>
              </button>
              {QUOTA_LAYERS.map(spec => {
                const window = byLayer.get(spec.id)
                const isHovered = hovered !== undefined
                  && hovered.provider === card.def.short
                  && hovered.spec.id === spec.id
                return (
                  <QuotaCell
                    key={spec.id}
                    provider={card.def.short}
                    spec={spec}
                    window={window}
                    hovered={isHovered}
                    onHover={setHovered}
                    t={t}
                  />
                )
              })}
            </div>
          )
        })}
        <div style={styles.statusRow}>
          <span style={styles.statusDot} />
          <span style={styles.statusText} title={active === undefined ? undefined : statusText(active, t)}>
            {loading ? t('quotaLoading') : statusText(active, t)}
          </span>
        </div>
      </div>
      {openProvider !== undefined && rpc !== undefined && (
        <ProviderPoolDialog
          rpc={rpc}
          provider={openProvider}
          t={t}
          onClose={() => setOpenProvider(undefined)}
          onChanged={() => { void refresh() }}
        />
      )}
    </>
  )
}
