/**
 * Codex CLI import tests: map `~/.codex/auth.json` into a read-only session
 * without ever rotating the CLI's refresh token.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codexCliAuthFilePath, readCodexCliCredentials } from '../src/auth/codex-cli-creds.js'

/** Unsigned JWT-shaped token whose payload the importer can decode. */
function token(payload: Record<string, unknown>): string {
  const b64 = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`
}

const ACCOUNT_ID = '05db0536-0b07-458a-8c44-b537b752e56f'
const AUTH_CLAIM = 'https://api.openai.com/auth'
const PROFILE_CLAIM = 'https://api.openai.com/profile'

/** The future second a fake access token should expire at. */
const FUTURE_EXP = Math.floor(Date.now() / 1000) + 7 * 24 * 3600

test('reads the Codex CLI ChatGPT login as a read-only snapshot', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codex-cli-'))
  const previous = process.env.CODEX_HOME
  process.env.CODEX_HOME = home
  try {
    const accessToken = token({
      exp: FUTURE_EXP,
      email: 'codex@example.com',
      [AUTH_CLAIM]: { chatgpt_account_id: ACCOUNT_ID, chatgpt_plan_type: 'pro' },
      [PROFILE_CLAIM]: { email: 'codex@example.com' },
    })
    const idToken = token({
      exp: FUTURE_EXP,
      email: 'codex@example.com',
      [AUTH_CLAIM]: { chatgpt_account_id: ACCOUNT_ID, chatgpt_plan_type: 'pro' },
    })
    await writeFile(codexCliAuthFilePath(), JSON.stringify({
      auth_mode: 'chatgpt',
      tokens: {
        access_token: accessToken,
        refresh_token: 'refresh-token',
        id_token: idToken,
        account_id: ACCOUNT_ID,
      },
    }))
    const session = readCodexCliCredentials()
    assert.ok(session)
    assert.equal(session.accessToken, accessToken)
    assert.equal(session.refreshToken, 'refresh-token')
    assert.equal(session.expiresAt, FUTURE_EXP * 1000)
    assert.equal(session.accountId, ACCOUNT_ID)
    assert.equal(session.emailAddress, 'codex@example.com')
    assert.equal(session.planType, 'pro')
    assert.equal(session.idToken, idToken)
    assert.equal(session.cliSnapshot, true)
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

test('rejects API-key mode, missing files and malformed tokens', async () => {
  const home = await mkdtemp(join(tmpdir(), 'codex-cli-'))
  const previous = process.env.CODEX_HOME
  process.env.CODEX_HOME = home
  try {
    assert.equal(readCodexCliCredentials(), undefined, 'missing auth file')
    await writeFile(codexCliAuthFilePath(), JSON.stringify({ auth_mode: 'api-key', OPENAI_API_KEY: 'sk-test' }))
    assert.equal(readCodexCliCredentials(), undefined, 'API-key mode has no ChatGPT session')
    await writeFile(codexCliAuthFilePath(), JSON.stringify({ tokens: { access_token: 'not-a-jwt', refresh_token: 'r' } }))
    assert.equal(readCodexCliCredentials(), undefined, 'undecodable access token')
  } finally {
    if (previous === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})
