/**
 * Pure data model for the compact quota board: fixed window slots, default
 * (smallest-window) selection and the used→remaining percentage inversion.
 * The board renders one horizontal bar per reported window; missing windows
 * keep their slot but draw no bar. Bars share one colour by design.
 * React-free so node tests can cover it without a browser.
 */
import type { UsageWindow } from './SubscriptionsSection.js'
import type { SubscriptionsKey } from './locales.js'

/** The three time windows, in display order (smallest → largest). */
export type QuotaLayerId = 'session' | 'weekly' | 'monthly'

/** One fixed slot: order is fixed on every provider column. */
export interface QuotaLayerSpec {
  /** Time window this slot measures. */
  id: QuotaLayerId
  /** Locale key of the full unit label. */
  labelKey: SubscriptionsKey
  /** Locale key of the narrow column label (5h / 周 / 月). */
  shortLabelKey: SubscriptionsKey
}

/**
 * Fixed slots, in display order. A provider without one window keeps the slot
 * blank so positions stay comparable across GPT / OpenCode / Claude.
 */
export const QUOTA_LAYERS: readonly QuotaLayerSpec[] = [
  { id: 'session', labelKey: 'quotaSession', shortLabelKey: 'quotaSessionShort' },
  { id: 'weekly', labelKey: 'quotaWeekly', shortLabelKey: 'quotaWeeklyShort' },
  { id: 'monthly', labelKey: 'quotaMonthly', shortLabelKey: 'quotaMonthlyShort' },
]

/**
 * The window that feeds one slot.
 * @param windows - provider usage windows.
 * @param layer - fixed layer id.
 * @returns the matching window, or undefined when the provider has no limit for it.
 */
export function quotaWindowForLayer(windows: readonly UsageWindow[], layer: QuotaLayerId): UsageWindow | undefined {
  if (layer === 'session') return windows.find(window => window.kind === 'session')
  if (layer === 'weekly') {
    const weekly = windows.filter(window => window.kind === 'weekly')
    return weekly.find(window => window.scope === undefined) ?? weekly[0]
  }
  return windows.find(window => window.kind === 'other' && window.scope === 'monthly')
}

/**
 * Group one provider's windows by fixed slot.
 * @param windows - provider usage windows.
 * @returns slot id → window for every reported layer.
 */
export function quotaWindowsByLayer(windows: readonly UsageWindow[]): Map<QuotaLayerId, UsageWindow> {
  const result = new Map<QuotaLayerId, UsageWindow>()
  for (const layer of QUOTA_LAYERS) {
    const window = quotaWindowForLayer(windows, layer.id)
    if (window !== undefined) result.set(layer.id, window)
  }
  return result
}

/**
 * The default slot: the smallest time unit the provider actually reports.
 * (5h when present, else weekly, else monthly — so GPT starts on the weekly
 * bar while OpenCode Go starts on the 5h bar.)
 * @param byLayer - grouped windows.
 * @returns the default layer id, or undefined when no window exists.
 */
export function defaultQuotaLayer(byLayer: ReadonlyMap<QuotaLayerId, UsageWindow>): QuotaLayerId | undefined {
  return QUOTA_LAYERS.find(layer => byLayer.has(layer.id))?.id
}

/** Remaining quota percentage: bars fill with what is LEFT, not what is used. */
export function remainingPercent(window: UsageWindow): number {
  const used = Number.isFinite(window.usedPercent) ? window.usedPercent : 0
  return Math.max(0, Math.min(100, 100 - used))
}

/** Compact `MM/DD HH:mm` reset label for the footer. */
export function formatQuotaReset(at: number): string {
  const date = new Date(at)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
