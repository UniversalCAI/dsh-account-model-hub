/** Pool-activity registry: what the footer shows as the active pool account. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearPoolActive, notePoolActive, poolActiveAccount } from '../src/providers/pool-activity.js'

test('records the pool member the footer should display', () => {
  clearPoolActive('codex')
  clearPoolActive('opencode-go-hub')
  assert.equal(poolActiveAccount('opencode-go-hub'), undefined)
  notePoolActive('opencode-go-hub', 'token-b')
  assert.equal(poolActiveAccount('opencode-go-hub'), 'token-b')
  notePoolActive('opencode-go-hub', 'token-c')
  assert.equal(poolActiveAccount('opencode-go-hub'), 'token-c')
})

test('clearing one account does not drop a different active account', () => {
  clearPoolActive('opencode-go-hub')
  notePoolActive('opencode-go-hub', 'token-b')
  clearPoolActive('opencode-go-hub', 'token-x')
  assert.equal(poolActiveAccount('opencode-go-hub'), 'token-b')
  clearPoolActive('opencode-go-hub', 'token-b')
  assert.equal(poolActiveAccount('opencode-go-hub'), undefined)
})
