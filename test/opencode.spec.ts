/**
 * OpenCode Go adapter unit tests: catalog shape, protocol endpoint derivation,
 * routing-header stability, account-session shape and usage parsing.
 *
 * These run offline. A live end-to-end check for the three wires is documented
 * in `docs/opencode-go.md` because it needs a real account.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_OPENCODE_BASE_URL,
  fetchOpencodeUsage,
  isOpencodeSession,
  opencodeGatewayBase,
  opencodeModelBase,
  opencodeModelsUrl,
  opencodeSessionFor,
  opencodeSessionValue,
  opencodeUsageUrl,
  parseOpencodeUsage,
} from '../src/providers/opencode.js'
import { OPENCODE_MODELS, OPENCODE_MODEL_BY_ID } from '../src/providers/opencode-models.js'
import { accountKeyOf } from '../src/auth/store.js'

test('generated catalog covers the three wires with unique ids', () => {
  assert.equal(OPENCODE_MODELS.length, 30)
  assert.equal(new Set(OPENCODE_MODELS.map(model => model.id)).size, OPENCODE_MODELS.length)
  const wires = new Set(OPENCODE_MODELS.map(model => model.api))
  assert.deepEqual([...wires].sort(), ['anthropic-messages', 'openai-completions', 'openai-responses'])
  for (const model of OPENCODE_MODELS) {
    assert.ok(model.id.length > 0)
    assert.ok(model.name.length > 0)
    assert.ok(model.input.length > 0)
    assert.equal(OPENCODE_MODEL_BY_ID.get(model.id), model)
  }
})

test('protocol endpoints derive from the multi-protocol gateway root', () => {
  assert.equal(opencodeGatewayBase('https://opencode.ai/zen/go/v1'), DEFAULT_OPENCODE_BASE_URL)
  assert.equal(opencodeModelBase('openai-completions', DEFAULT_OPENCODE_BASE_URL), 'https://opencode.ai/inference/go/openai/v1')
  assert.equal(opencodeModelBase('openai-responses', DEFAULT_OPENCODE_BASE_URL), 'https://opencode.ai/inference/go/openai/v1')
  assert.equal(opencodeModelBase('anthropic-messages', DEFAULT_OPENCODE_BASE_URL), 'https://opencode.ai/inference/go/anthropic')
  assert.equal(opencodeUsageUrl(DEFAULT_OPENCODE_BASE_URL), 'https://opencode.ai/inference/go/v1/usage')
  assert.equal(opencodeModelsUrl(DEFAULT_OPENCODE_BASE_URL), 'https://opencode.ai/inference/go/v1/models')
  // A user-supplied direct gateway keeps its own path shape.
  assert.equal(opencodeModelBase('openai-completions', 'https://proxy.example/v1'), 'https://proxy.example/v1')
  assert.equal(opencodeModelBase('anthropic-messages', 'https://proxy.example/v1'), 'https://proxy.example')
})

test('routing session header is stable for plain ids and hashed for anything else', () => {
  assert.equal(opencodeSessionValue('session-abc'), 'session-abc')
  // Reserved prefix: even a plain id under the namespace is hashed (not echoed).
  assert.match(opencodeSessionValue('dsh-go-session-v1-existing'), /^dsh-go-session-v1-[A-Za-z0-9_-]+$/)
  assert.notEqual(opencodeSessionValue('dsh-go-session-v1-existing'), 'dsh-go-session-v1-existing')
  const hashed = opencodeSessionValue('会话-abc')
  assert.match(hashed, /^dsh-go-session-v1-[A-Za-z0-9_-]+$/)
  assert.equal(hashed, opencodeSessionValue('会话-abc'))
  assert.notEqual(opencodeSessionValue(undefined), opencodeSessionValue(undefined))
})

test('API-key sessions are fixed-shape and keyed by a hash of the key', () => {
  const session = opencodeSessionFor('sk-test-abcdefgh', 'work')
  assert.equal(session.accessToken, 'sk-test-abcdefgh')
  assert.equal(session.refreshToken, 'api-key')
  assert.equal(session.expiresAt, Number.MAX_SAFE_INTEGER)
  assert.equal(session.account, 'work')
  assert.equal(isOpencodeSession(session), true)
  assert.equal(isOpencodeSession({ accessToken: '' }), false)
  assert.equal(isOpencodeSession(null), false)
  const key = accountKeyOf('opencode-go-hub', session)
  assert.match(key, /^token-[0-9a-f]{16}$/)
  assert.ok(!key.includes('sk-test'))
  assert.equal(accountKeyOf('opencode-go-hub', opencodeSessionFor('sk-test-abcdefgh', 'other')), key, 'same key keeps one account slot')
})

test('usage parser maps the three windows and rejects malformed payloads', () => {
  const usage = parseOpencodeUsage({
    usage: {
      rolling: { status: 'ok', percent: 12.5, resetsAt: '2026-10-24T10:00:00Z' },
      weekly: { status: 'rate-limited', percent: 100, resetsAt: '2026-10-29T00:00:00Z' },
      monthly: { status: 'ok', percent: 20, resetsAt: '2026-11-01T00:00:00Z' },
    },
  })
  assert.equal(usage.supported, true)
  assert.deepEqual(usage.windows?.map(window => window.kind), ['session', 'weekly', 'other'])
  assert.equal(usage.windows?.[1].usedPercent, 100)
  assert.equal(usage.windows?.[2].scope, 'monthly')
  assert.equal(usage.windows?.[0].resetsAt, Date.parse('2026-10-24T10:00:00Z'))
  assert.throws(() => parseOpencodeUsage({ usage: { rolling: { status: 'ok', percent: 500 } } }))
  assert.throws(() => parseOpencodeUsage({}))
})

test('usage fetch sends the bearer and parses the gateway response', async () => {
  let seen: { url: string; auth: string } | undefined
  const fetchFn = async (url: string, init: { headers: Record<string, string> }) => {
    seen = { url, auth: init.headers.authorization }
    return new Response(JSON.stringify({
      usage: {
        rolling: { status: 'ok', percent: 7, resetsAt: '2026-10-24T12:20:15.000Z' },
        weekly: { status: 'ok', percent: 54, resetsAt: '2026-10-26T00:00:00.000Z' },
        monthly: { status: 'ok', percent: 27, resetsAt: '2026-11-22T08:37:24.000Z' },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const usage = await fetchOpencodeUsage(opencodeSessionFor('sk-live-test', 'live'), DEFAULT_OPENCODE_BASE_URL, undefined, fetchFn as typeof fetch)
  assert.ok(seen !== undefined)
  assert.equal(seen.url, opencodeUsageUrl(DEFAULT_OPENCODE_BASE_URL))
  assert.equal(seen.auth, 'Bearer sk-live-test')
  assert.equal(usage.windows?.length, 3)
})
