/**
 * Provider account pool dialog: opened by clicking the GPT / OpenCode / Claude
 * identity cell in the footer quota board. Lists every logged-in account of
 * that provider with its remaining quota windows and exact reset times, marks
 * the pool's active account and the manual pin, and lets the user pin an
 * account (or restore automatic selection). Data comes from the same
 * `status` + `usage` RPC endpoints the board uses; the pin is a soft
 * preference applied by the pool when its account is healthy and has quota.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import { callSubscriptionsAuth } from './SubscriptionsSection.js'
import type {
  AccountStatus,
  ProviderStatus,
  ProviderUsage,
  SubscriptionProvider,
  UsageWindow,
} from './SubscriptionsSection.js'
import { formatQuotaReset, remainingPercent } from './quota-model.js'
import type { SubscriptionsKey } from './locales.js'

/** Provider identity shown by one dialog. */
export interface PoolDialogProvider {
  id: SubscriptionProvider
  title: string
  short: string
}

/** Props for {@link ProviderPoolDialog}. */
export interface ProviderPoolDialogProps {
  rpc: ConnectionHandle['rpc']
  provider: PoolDialogProvider
  t: (key: SubscriptionsKey, params?: Record<string, unknown>) => string
  onClose: () => void
  /** Called after a pin change so the footer refreshes its status snapshot. */
  onChanged?: () => void
}

/** One account row in the dialog. */
interface PoolRow {
  account: AccountStatus
  usage?: ProviderUsage
  error?: string
}

/** `status` endpoint subset. */
interface StatusResponse {
  providers: Partial<Record<SubscriptionProvider, ProviderStatus>>
}

/** Human text of a failure. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Full local reset date/time for the detail dialog. */
function fullReset(at: number | undefined): string {
  if (at === undefined) return '—'
  const date = new Date(at)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—'
}

/** Full label of one usage window (scope suffix for Claude model lanes). */
function windowLabel(t: (key: SubscriptionsKey, params?: Record<string, unknown>) => string, window: UsageWindow): string {
  const base = window.kind === 'session'
    ? t('quotaSession')
    : window.kind === 'weekly'
      ? t('quotaWeekly')
      : window.scope === 'monthly'
        ? t('quotaMonthly')
        : t('quotaOther')
  return window.scope === undefined || window.scope === 'monthly' ? base : `${base} · ${window.scope}`
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1200,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    background: 'var(--dsw-alias-bg-mask-1, #0008)', backdropFilter: 'var(--dsw-mask-blur, none)',
  },
  dialog: {
    width: 480, maxWidth: '100%', maxHeight: '86vh', overflowY: 'auto', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: 10,
    padding: '14px 16px 12px', borderRadius: 'var(--dsw-radius-panel, 24px)',
    background: 'var(--dsw-alias-bg-layer-2)', border: 0, boxShadow: 'var(--dsw-elevation-prominent)',
    color: 'var(--dsw-alias-label-primary)',
  },
  header: { display: 'flex', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, lineHeight: '22px', fontWeight: 600 },
  subtitle: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', marginLeft: 2 },
  headerSpacer: { flex: 1 },
  close: { minHeight: 26, height: 26, padding: '0 10px' },
  hint: { margin: 0, fontSize: 11, lineHeight: '17px', color: 'var(--dsw-alias-label-tertiary)' },
  actionsRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  autoPill: {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 999,
    padding: '2px 8px', fontSize: 10.5, lineHeight: '15px', color: 'var(--dsw-alias-label-secondary)',
  },
  accountCard: {
    border: '0.5px solid var(--dsw-alias-border-l2)', borderRadius: 'var(--dsw-radius-lg, 16px)',
    padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6,
  },
  accountCardPreferred: { borderColor: 'var(--dsw-alias-state-info-primary, #6aa9ff)' },
  accountHead: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  accountName: { fontSize: 12.5, lineHeight: '18px', fontWeight: 600, wordBreak: 'break-all' },
  badge: {
    fontSize: 9.5, lineHeight: '13px', padding: '1px 6px', borderRadius: 999,
    color: 'var(--dsw-alias-label-secondary)', border: '0.5px solid var(--dsw-alias-border-l2)',
  },
  badgeActive: { color: 'var(--dsw-alias-state-success-primary)', borderColor: 'var(--dsw-alias-state-success-primary)' },
  badgePreferred: { color: 'var(--dsw-alias-state-info-primary, #6aa9ff)', borderColor: 'var(--dsw-alias-state-info-primary, #6aa9ff)' },
  useButton: { marginLeft: 'auto', minHeight: 24, height: 24, padding: '0 9px', fontSize: 11 },
  window: { display: 'flex', flexDirection: 'column', gap: 2 },
  windowHead: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10.5, lineHeight: '15px' },
  windowLabel: { color: 'var(--dsw-alias-label-secondary)' },
  windowPct: { color: 'var(--dsw-alias-label-primary)', fontVariantNumeric: 'tabular-nums' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', background: 'rgba(148, 163, 184, 0.22)' },
  fill: { height: '100%', borderRadius: 2, background: 'var(--dsw-alias-state-info-primary, #6aa9ff)' },
  reset: { fontSize: 10, lineHeight: '14px', color: 'var(--dsw-alias-label-tertiary)', fontVariantNumeric: 'tabular-nums' },
  empty: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)' },
  error: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-state-error-primary)' },
  credits: { fontSize: 10, lineHeight: '14px', color: 'var(--dsw-alias-label-tertiary)' },
  note: { fontSize: 10, lineHeight: '15px', color: 'var(--dsw-alias-label-tertiary)' },
  footer: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' },
  notice: { marginRight: 'auto', fontSize: 10.5, lineHeight: '16px', color: 'var(--dsw-alias-label-secondary)' },
}

/**
 * Account pool dialog. Fetches the provider's status + per-account usage on
 * open, lists every account with all windows and exact reset times, and pins
 * the selected account through the `setPreferredAccount` endpoint.
 */
export function ProviderPoolDialog(props: ProviderPoolDialogProps) {
  const { rpc, provider, t, onClose, onChanged } = props
  const [rows, setRows] = useState<readonly PoolRow[] | undefined>(undefined)
  const [active, setActive] = useState<string | undefined>(undefined)
  const [preferred, setPreferred] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [pendingKey, setPendingKey] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const mountedRef = useRef(true)

  const load = useCallback(async (force = false): Promise<void> => {
    setLoading(true)
    setError(undefined)
    try {
      const status = await callSubscriptionsAuth<StatusResponse>(rpc, 'status', {})
      const providerStatus = status.providers?.[provider.id]
      const accounts = providerStatus?.accounts ?? []
      setActive(providerStatus?.activeAccount)
      setPreferred(providerStatus?.preferredAccount)
      const next = await Promise.all(accounts.map(async (account): Promise<PoolRow> => {
        try {
          const usage = await callSubscriptionsAuth<ProviderUsage>(rpc, 'usage', {
            provider: provider.id,
            account: account.key,
            ...force ? { force: true } : {},
          })
          return { account, usage }
        } catch (caught) {
          return { account, error: messageOf(caught) }
        }
      }))
      if (mountedRef.current) setRows(next)
    } catch (caught) {
      if (mountedRef.current) setError(messageOf(caught))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [rpc, provider.id])

  useEffect(() => {
    mountedRef.current = true
    void load()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      mountedRef.current = false
      document.removeEventListener('keydown', onKey)
    }
  }, [load, onClose])

  const switchTo = async (account?: string): Promise<void> => {
    setPendingKey(account ?? 'auto')
    setError(undefined)
    try {
      await callSubscriptionsAuth<{ ok: true }>(rpc, 'setPreferredAccount', {
        provider: provider.id,
        ...account === undefined ? {} : { account },
      })
      setNotice(account === undefined ? t('poolDialogPreferenceCleared') : t('poolDialogPreferenceSet'))
      await load()
      onChanged?.()
    } catch (caught) {
      setError(messageOf(caught))
    } finally {
      if (mountedRef.current) setPendingKey(undefined)
    }
  }

  return createPortal(
    <div style={styles.overlay} onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div style={styles.dialog} role="dialog" aria-modal="true" aria-label={provider.title}>
        <div style={styles.header}>
          <span style={styles.title}>{provider.title}</span>
          <span style={styles.subtitle}>{provider.short}</span>
          <span style={styles.headerSpacer} />
          <button type="button" style={styles.close} onClick={onClose}>{t('poolDialogClose')}</button>
        </div>
        <p style={styles.hint}>{t('poolDialogHint')}</p>
        <div style={styles.actionsRow}>
          {preferred === undefined
            ? <span style={styles.autoPill}>{t('poolDialogAutoActive')}</span>
            : (
              <button type="button" disabled={pendingKey !== undefined} onClick={() => { void switchTo(undefined) }}>
                {t('poolDialogAuto')}
              </button>
            )}
          <button type="button" disabled={loading} onClick={() => { void load(true) }}>
            {loading ? t('quotaLoading') : t('poolDialogRefresh')}
          </button>
        </div>
        {error !== undefined && <div style={styles.error}>{t('poolDialogFailed', { message: error })}</div>}
        {notice !== undefined && <div style={styles.notice}>{notice}</div>}
        {rows === undefined
          ? <div style={styles.empty}>{t('poolDialogLoading')}</div>
          : rows.length === 0
            ? <div style={styles.empty}>{t('poolDialogNoAccounts')}</div>
            : rows.map(row => {
                const key = row.account.key
                const isPreferred = preferred === key
                return (
                  <div key={key} style={{ ...styles.accountCard, ...isPreferred ? styles.accountCardPreferred : {} }}>
                    <div style={styles.accountHead}>
                      <span style={styles.accountName}>{row.account.account ?? key}</span>
                      {row.account.plan !== undefined && <span style={styles.badge}>{row.account.plan}</span>}
                      {active === key && <span style={{ ...styles.badge, ...styles.badgeActive }}>{t('poolDialogCurrent')}</span>}
                      {isPreferred && <span style={{ ...styles.badge, ...styles.badgePreferred }}>{t('poolDialogPreferred')}</span>}
                      {row.account.isDefault && <span style={styles.badge}>{t('poolDialogDefault')}</span>}
                      <button
                        type="button"
                        style={styles.useButton}
                        disabled={pendingKey !== undefined || isPreferred}
                        onClick={() => { void switchTo(key) }}
                      >
                        {isPreferred ? t('poolDialogPreferred') : t('poolDialogUse')}
                      </button>
                    </div>
                    {row.error !== undefined
                      ? <div style={styles.error}>{row.error}</div>
                      : row.usage === undefined || row.usage.supported === false
                        ? <div style={styles.empty}>{t('quotaNoWindows')}</div>
                        : (
                          <>
                            {(row.usage.windows ?? []).length === 0
                              ? <div style={styles.empty}>{t('quotaNoWindows')}</div>
                              : (row.usage.windows ?? []).map((window, index) => {
                                  const remaining = remainingPercent(window)
                                  return (
                                    <div key={`${window.kind}:${window.scope ?? ''}:${String(index)}`} style={styles.window}>
                                      <div style={styles.windowHead}>
                                        <span style={styles.windowLabel}>{windowLabel(t, window)}</span>
                                        <span style={styles.windowPct}>{Math.round(remaining)}%</span>
                                      </div>
                                      <span style={styles.track}>
                                        <span style={{
                                          ...styles.fill,
                                          display: 'block',
                                          width: `${String(remaining)}%`,
                                          ...remaining < 15 ? { background: 'var(--dsw-alias-state-warn-label)' } : {},
                                        }} />
                                      </span>
                                      <span style={styles.reset}>{t('quotaReset')} {fullReset(window.resetsAt)}</span>
                                    </div>
                                  )
                                })}
                            {row.usage.resetCredits !== undefined && row.usage.resetCredits.length > 0 && (
                              <span style={styles.credits}>{t('resetCreditsTitle')} · {t('resetCreditsAvailable', { count: row.usage.resetCredits.length })}</span>
                            )}
                            {row.usage.resetCreditsError !== undefined && (
                              <span style={styles.credits}>{t('resetCreditsError', { message: row.usage.resetCreditsError })}</span>
                            )}
                          </>
                        )}
                    {row.usage !== undefined && row.usage.windows !== undefined && row.usage.windows.length > 0 && (
                      <span style={styles.note}>{t('poolDialogSharedQuota')}</span>
                    )}
                  </div>
                )
              })}
        <div style={styles.footer}>
          <span style={styles.notice}>{t('poolDialogFooter')}</span>
          <button type="button" onClick={onClose}>{t('poolDialogClose')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
