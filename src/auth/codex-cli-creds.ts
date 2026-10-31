/**
 * Import the Codex CLI's local ChatGPT login as a read-only session.
 *
 * The Codex CLI stores its OAuth tokens in `$CODEX_HOME/auth.json` (default
 * `~/.codex/auth.json`). The refresh token is deliberately NOT rotated by this
 * plugin: rotating it would invalidate the CLI's own copy and log the user out
 * of the CLI. The imported session therefore carries {@link CodexSession.cliSnapshot}
 * and the adapter refuses to refresh it; after the CLI renews its login the
 * user imports again (the store keys the account by its ChatGPT account id, so
 * a re-import replaces the snapshot in place).
 *
 * This mirrors the "adopted snapshot is never refreshed" import policy used by
 * the subscription plugins this fork draws on.
 *
 * @module dsh-account-model-hub/codex-cli-creds
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decodeJwtPayload } from './jwt.js'
import type { CodexSession } from './store.js'

/** The subset of Codex CLI's auth file this importer reads. */
interface CodexCliAuthFile {
  tokens?: {
    access_token?: unknown
    refresh_token?: unknown
    id_token?: unknown
    account_id?: unknown
  }
}

/** Absolute path of Codex CLI's auth file. */
export function codexCliAuthFilePath(): string {
  return join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json')
}

/** ChatGPT auth claim object from one JWT, when present. */
function authClaim(token: string | undefined): Record<string, unknown> | undefined {
  const payload = token === undefined ? undefined : decodeJwtPayload(token)
  const claim = payload?.['https://api.openai.com/auth']
  return typeof claim === 'object' && claim !== null ? claim as Record<string, unknown> : undefined
}

/** Email from a JWT payload, either top-level or in OpenAI's profile claim. */
function emailClaim(token: string | undefined): string | undefined {
  const payload = token === undefined ? undefined : decodeJwtPayload(token)
  const email = payload?.email
  if (typeof email === 'string' && email.length > 0) return email
  const profile = payload?.['https://api.openai.com/profile']
  const profileEmail = typeof profile === 'object' && profile !== null
    ? (profile as Record<string, unknown>).email
    : undefined
  return typeof profileEmail === 'string' && profileEmail.length > 0 ? profileEmail : undefined
}

/** Read one token claim as a non-empty string. */
function stringClaim(claim: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = claim?.[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read the Codex CLI's current ChatGPT login.
 * @returns a read-only snapshot session, or undefined when the CLI has no
 *   usable ChatGPT login (missing file, API-key mode, or malformed tokens).
 */
export function readCodexCliCredentials(): CodexSession | undefined {
  let parsed: CodexCliAuthFile
  try {
    parsed = JSON.parse(readFileSync(codexCliAuthFilePath(), 'utf8')) as CodexCliAuthFile
  } catch {
    return undefined
  }
  const tokens = parsed.tokens
  if (tokens === undefined || tokens === null || typeof tokens !== 'object') return undefined
  const accessToken = typeof tokens.access_token === 'string' && tokens.access_token.length > 0
    ? tokens.access_token
    : undefined
  const refreshToken = typeof tokens.refresh_token === 'string' && tokens.refresh_token.length > 0
    ? tokens.refresh_token
    : undefined
  if (accessToken === undefined || refreshToken === undefined) return undefined
  const expiresAtSeconds = decodeJwtPayload(accessToken)?.exp
  if (typeof expiresAtSeconds !== 'number' || !Number.isFinite(expiresAtSeconds)) return undefined
  const idToken = typeof tokens.id_token === 'string' && tokens.id_token.length > 0 ? tokens.id_token : undefined
  const auth = authClaim(idToken) ?? authClaim(accessToken)
  const accountId = (typeof tokens.account_id === 'string' && tokens.account_id.length > 0 ? tokens.account_id : undefined)
    ?? stringClaim(auth, 'chatgpt_account_id')
  if (accountId === undefined) return undefined
  const planType = stringClaim(auth, 'chatgpt_plan_type')
  const emailAddress = emailClaim(idToken) ?? emailClaim(accessToken)
  return {
    accessToken,
    refreshToken,
    expiresAt: Math.trunc(expiresAtSeconds * 1000),
    accountId,
    ...idToken === undefined ? {} : { idToken },
    ...emailAddress === undefined ? {} : { emailAddress },
    ...planType === undefined ? {} : { planType },
    cliSnapshot: true,
  }
}
