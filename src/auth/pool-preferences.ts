/**
 * Persisted manual account preference for the account pool.
 *
 * The quota-aware scheduler normally picks the member with the highest
 * required burn rate. The footer's provider dialog lets the user override that
 * choice for one provider ("use this account"); the override is a soft pin:
 * the selected account leads the candidate order when it is healthy and has
 * quota left, but a quota-full/cooling account still fails over automatically.
 * Stored separately from the token store (no secrets; account keys are hashes).
 *
 * @module dsh-account-model-hub/pool-preferences
 */

import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Provider id → preferred account key. */
const preferred = new Map<string, string>()
let loaded: Promise<void> | undefined
let writeChain: Promise<void> = Promise.resolve()

/** Absolute path of the pool preference file. */
function preferencesFilePath(): string {
  return dshHomePath('plugins', 'account-hub', 'pool-preferences.json')
}

/** Load the preference file once; malformed entries are ignored instead of failing startup. */
export function loadPoolPreferences(): Promise<void> {
  loaded ??= (async () => {
    let text: string
    try {
      text = await readFile(preferencesFilePath(), 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // An unreadable preference file must not take the plugin down.
      }
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return
    for (const [provider, account] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof account === 'string' && account.length > 0) preferred.set(provider, account)
    }
  })()
  return loaded
}

/** The manual account preference for one provider, if any. */
export function preferredAccountOf(provider: string): string | undefined {
  return preferred.get(provider)
}

/** Atomically persist the current map (mode 0600 even though it carries no secrets). */
async function persist(): Promise<void> {
  writeChain = writeChain.then(async () => {
    const path = preferencesFilePath()
    const serialized = JSON.stringify(Object.fromEntries([...preferred].sort(([a], [b]) => a.localeCompare(b))), null, 2) + '\n'
    try {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
      await writeFile(tmp, serialized, { mode: 0o600 })
      await rename(tmp, path)
      await chmod(path, 0o600).catch(() => undefined)
    } catch {
      // A read-only home leaves the in-memory override active for this process.
    }
  })
  return writeChain
}

/**
 * Pin one account for a provider, or clear the pin.
 * @param provider - provider route id.
 * @param account - account key to prefer; omit to restore automatic scheduling.
 */
export async function setPoolPreferredAccount(provider: string, account?: string): Promise<void> {
  await loadPoolPreferences()
  if (account === undefined) preferred.delete(provider)
  else preferred.set(provider, account)
  await persist()
}

/**
 * Drop a preference when its account is logged out or replaced.
 * @param provider - provider route id.
 * @param account - only clear when this account is the pinned one.
 */
export async function clearPoolPreferredAccount(provider: string, account: string): Promise<void> {
  await loadPoolPreferences()
  if (preferred.get(provider) !== account) return
  preferred.delete(provider)
  await persist()
}

/** Drop every manual pool preference (used by logout-all). */
export async function clearAllPoolPreferences(): Promise<void> {
  await loadPoolPreferences()
  if (preferred.size === 0) return
  preferred.clear()
  await persist()
}
