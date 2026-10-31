/**
 * In-memory record of which account the pool served most recently, per
 * provider. The quota footer uses it to show the account that is actually
 * active in the pool rather than the default or an arbitrary member.
 *
 * This is presentation state only: it resets with the host process and never
 * influences routing. `PoolAdapter` notes the member after its first content
 * chunk, so a failed-before-output attempt does not claim the slot.
 */

const active = new Map<string, string>()

/**
 * Remember the account that just served a chunk for one provider.
 * @param provider - provider route id.
 * @param account - account key from the auth store.
 */
export function notePoolActive(provider: string, account: string): void {
  active.set(provider, account)
}

/**
 * The account the pool served most recently for one provider.
 * @param provider - provider route id.
 * @returns the account key, or undefined when no pooled request has succeeded.
 */
export function poolActiveAccount(provider: string): string | undefined {
  return active.get(provider)
}

/**
 * Forget the active account after logout/removal (or all accounts).
 * @param provider - provider route id.
 * @param account - only clear when this account is the recorded one; omit to clear unconditionally.
 */
export function clearPoolActive(provider: string, account?: string): void {
  if (account === undefined || active.get(provider) === account) active.delete(provider)
}
