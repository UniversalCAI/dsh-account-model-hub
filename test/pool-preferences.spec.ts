/** Pool manual-pin persistence: one preference per provider, no secrets. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadPoolPreferences,
  preferredAccountOf,
  setPoolPreferredAccount,
} from '../src/auth/pool-preferences.js'

test('persists and clears one provider pin without touching others', async () => {
  const home = await mkdtemp(join(tmpdir(), 'pool-prefs-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    await loadPoolPreferences()
    await setPoolPreferredAccount('opencode-go-hub', 'token-b')
    await setPoolPreferredAccount('codex', 'acct-codex')
    assert.equal(preferredAccountOf('opencode-go-hub'), 'token-b')
    assert.equal(preferredAccountOf('codex'), 'acct-codex')
    const file = join(home, 'plugins', 'account-hub', 'pool-preferences.json')
    const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, string>
    assert.deepEqual(stored, { codex: 'acct-codex', 'opencode-go-hub': 'token-b' })

    await setPoolPreferredAccount('opencode-go-hub')
    assert.equal(preferredAccountOf('opencode-go-hub'), undefined)
    assert.equal(preferredAccountOf('codex'), 'acct-codex')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})
