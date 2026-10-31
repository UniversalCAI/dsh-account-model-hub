/**
 * OpenCode Go adapter: a subscription gateway route that speaks the same
 * OpenAI-compatible Chat Completions / Responses wires as the models it serves,
 * plus the Anthropic Messages wire for the Anthropic-family entries.
 *
 * Unlike the OAuth subscription providers in this plugin, OpenCode Go
 * credentials are long-lived API keys. The account pool therefore stores one
 * key per account and never refreshes anything: an invalid key is a
 * credential failure (the account stays visible so the user can replace it),
 * while an exhausted quota is the pool's cue to try the next account.
 *
 * The route id is `opencode-go-hub`, not `opencode-go`: the harness ships its
 * own `opencode-go` route (pi-ai), and registering a second adapter for the
 * same route id is rejected at load time. The display name stays
 * "OpenCode Go" so the model picker reads naturally.
 *
 * @module dsh-account-model-hub/opencode
 */

import { createHash, randomUUID } from 'node:crypto'
import { LlmAdapter, LlmError, attributionHeaders, EMPTY_RESPONSE_CODE, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { AccountTokenManager } from './accounts.js'
import type { AccountAwareAdapter } from './accounts.js'
import { httpLlmError, idleWatchdog, mapFetchFailure } from './common.js'
import { effortDisplayName, mergeReasoning } from './common.js'
import type { ModelEntry, ProviderUsage, UsageWindow } from './common.js'
import { DEFAULT_RATE_LIMIT_WAIT, DEFAULT_RETRY, subscriptionRetryPolicy } from './rate-limit.js'
import type { RateLimitWait } from './rate-limit.js'
import type { PoolAdapter } from './pool.js'
import { proxiedFetch } from '../http.js'
import { resolveImages } from '../translate/resolved.js'
import type { TranslatableMessage } from '../translate/resolved.js'
import { streamChatCompletions, toChatMessages, toChatTools } from '../translate/chat-completions.js'
import { streamResponses, toResponsesInput, toResponsesTools } from '../translate/responses.js'
import {
  streamAnthropic,
  toAnthropicMessages,
  toAnthropicSystem,
  toAnthropicTools,
} from '../translate/anthropic.js'
import { OPENCODE_MODELS, OPENCODE_MODEL_BY_ID } from './opencode-models.js'
import type { OpencodeModelMeta, OpencodeWire } from './opencode-models.js'
import type { OpencodeSession, ProviderId } from '../auth/store.js'

/** Route id owned by this plugin (the harness already owns `opencode-go`). */
export const OPENCODE_PROVIDER_ID = 'opencode-go-hub'

/** Route label shown by the model picker. */
export const OPENCODE_DISPLAY_NAME = 'OpenCode Go (Hub)'

/** Default OpenCode Go gateway base URL (inference gateway; the old zen base is migrated). */
export const DEFAULT_OPENCODE_BASE_URL = 'https://opencode.ai/inference/go/v1'

/** Reserved prefix for non-ASCII session ids hashed into the routing header. */
const SESSION_HEADER_PREFIX = 'dsh-go-session-v1-'

/** Keep one logical call's gateway routing stable across account attempts. */
export function opencodeSessionValue(sessionId: string | undefined): string {
  if (sessionId === undefined || sessionId.length === 0) return randomUUID()
  if (!/[^\x21-\x7e]/.test(sessionId) && !sessionId.startsWith(SESSION_HEADER_PREFIX)) return sessionId
  return SESSION_HEADER_PREFIX + createHash('sha256').update(sessionId, 'utf16le').digest('base64url')
}

/** The gateway base, with the legacy `zen/go/v1` alias migrated to the new one. */
export function opencodeGatewayBase(baseURL: string): string {
  const base = baseURL.replace(/\/+$/, '')
  return base === 'https://opencode.ai/zen/go/v1' ? DEFAULT_OPENCODE_BASE_URL : base
}

/**
 * The model base URL the protocol's SDK appends its resource path to.
 *
 * The default gateway is a multi-protocol root: OpenAI wires live under
 * `/openai/v1`, the Anthropic wire under `/anthropic` (its SDK adds
 * `/v1/messages`). A user-supplied base URL is used as-is except for the
 * Anthropic wire, which expects the version-less root.
 */
export function opencodeModelBase(api: OpencodeWire, baseURL: string): string {
  const base = opencodeGatewayBase(baseURL)
  if (base === DEFAULT_OPENCODE_BASE_URL) {
    const gateway = base.replace(/\/v1$/, '')
    switch (api) {
      case 'openai-completions':
      case 'openai-responses': return `${gateway}/openai/v1`
      case 'anthropic-messages': return `${gateway}/anthropic`
    }
  }
  return api === 'anthropic-messages' ? base.replace(/\/v1$/, '') : base
}

/** One protocol request endpoint. */
function requestUrl(api: OpencodeWire, baseURL: string): string {
  const base = opencodeModelBase(api, baseURL)
  switch (api) {
    case 'openai-completions': return `${base}/chat/completions`
    case 'openai-responses': return `${base}/responses`
    case 'anthropic-messages': return `${base}/v1/messages`
  }
}

/** Per-account usage endpoint (5h / weekly / monthly windows). */
export function opencodeUsageUrl(baseURL: string): string {
  return `${opencodeGatewayBase(baseURL)}/usage`
}

/** Live model-id listing endpoint (used by future discovery; also the health probe). */
export function opencodeModelsUrl(baseURL: string): string {
  return `${opencodeGatewayBase(baseURL)}/models`
}

/** Constructor options for {@link OpencodeGoAdapter}. */
export interface OpencodeGoAdapterOptions {
  /** Per-account API-key sessions (never refresh; one key per account). */
  tokens: AccountTokenManager<OpencodeSession>
  /** Configured model entries (the built-in catalog seeds the config). */
  models: readonly ModelEntry[]
  /** Read the current gateway base URL at request time (settings are live). */
  baseURL: () => string
  streamIdleTimeoutMs: number
  rateLimit?: RateLimitWait
  onWarn?: (message: string) => void
  pool?: () => PoolAdapter | undefined
  /** Persisted per-model default effort override (the Settings page's picker). */
  defaultEffortOf?: (model: string) => string | undefined
  resolveAttachments?: () => AttachmentStore | undefined
  fetchFn?: typeof fetch
}

/** True when a stored session is one of ours. */
export function isOpencodeSession(value: unknown): value is OpencodeSession {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.accessToken === 'string' && record.accessToken.length > 0
}

/** The fixed session value fields for an OpenCode API key. */
export function opencodeSessionFor(apiKey: string, label?: string): OpencodeSession {
  return {
    accessToken: apiKey,
    refreshToken: 'api-key',
    expiresAt: Number.MAX_SAFE_INTEGER,
    ...label === undefined || label.trim().length === 0 ? {} : { account: label.trim() },
  }
}

/** Resolve the protocol for one model: the static catalog wins, then a config hint. */
function wireOf(model: string, configured?: ModelEntry): OpencodeWire {
  const known = OPENCODE_MODEL_BY_ID.get(model)?.api
  if (known !== undefined) return known
  if (configured?.wire === 'responses') return 'openai-responses'
  return 'openai-completions'
}

/** Levels DSH can select, in pi-ai's escalation order. */
const OPENCODE_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

/** pi-ai's budget-based thinking ladder for the Anthropic wire. */
const ANTHROPIC_THINKING_BUDGETS: Readonly<Record<string, number>> = {
  minimal: 1024,
  low: 2048,
  medium: 8192,
  high: 16384,
  xhigh: 16384,
  max: 16384,
}

/**
 * Selectable reasoning levels for one OpenCode model, mirroring pi-ai's
 * `getSupportedThinkingLevels`: an explicit `null` mapping disables a level,
 * `xhigh`/`max` are only offered when the catalog maps them, and the lower
 * levels stay available when the model reasons at all. A model with no
 * thinking map gets pi-ai's default ladder (off/minimal/low/medium/high).
 * @param meta - static catalog entry, or undefined for a configured-only model.
 * @returns the reasoning block, or undefined when the model does not reason.
 */
export function opencodeReasoning(meta: OpencodeModelMeta | undefined): LlmResolvedModelInfo['reasoning'] | undefined {
  if (meta?.reasoning !== true) return undefined
  const levels = OPENCODE_THINKING_LEVELS.filter(level => {
    const mapped = meta.thinkingLevelMap?.[level]
    if (mapped === null) return false
    if (level === 'xhigh' || level === 'max') return mapped !== undefined
    return true
  })
  if (levels.length === 0) return undefined
  return {
    efforts: levels.map(level => ({ id: ReasoningEffortId(level), name: effortDisplayName(level) })),
  }
}

/**
 * Request fields that materialize one selected effort for an OpenCode model.
 * The OpenCode gateway shares the OpenAI chat/responses and Anthropic messages
 * wires, so the three encodings differ:
 * - chat: `reasoning_effort`, or the model's `thinkingFormat` toggles;
 * - responses: nested `reasoning.effort`;
 * - anthropic: `thinking.budget_tokens` from pi-ai's budget ladder.
 * `off` omits the provider default (or explicitly disables it where the
 * model's compat metadata supports that); no selection adds nothing.
 * @param api - upstream wire derived from the catalog.
 * @param meta - static catalog entry supplying level mappings and compat.
 * @param effort - selected DSH effort, when the caller named one.
 * @returns fields to merge into the request body.
 */
export function opencodeReasoningFields(
  api: OpencodeWire,
  meta: OpencodeModelMeta | undefined,
  effort: GenerateOptions['reasoningEffort'],
): Record<string, unknown> {
  if (effort === undefined) return {}
  const level = String(effort)
  if (level === 'off') {
    if (meta?.thinkingFormat === 'qwen') return { enable_thinking: false }
    if (meta?.thinkingFormat === 'deepseek' && meta.thinkingLevelMap?.off !== null) {
      return { thinking: { type: 'disabled' } }
    }
    return {}
  }
  const wireLevel = meta?.thinkingLevelMap?.[level] ?? level
  if (api === 'openai-responses') return { reasoning: { effort: wireLevel } }
  if (api === 'anthropic-messages') {
    return { thinking: { type: 'enabled', budget_tokens: ANTHROPIC_THINKING_BUDGETS[level] ?? 1024 } }
  }
  if (meta?.thinkingFormat === 'deepseek') {
    return {
      thinking: { type: 'enabled' },
      ...meta.supportsReasoningEffort === false ? {} : { reasoning_effort: wireLevel },
    }
  }
  if (meta?.thinkingFormat === 'qwen') {
    return {
      enable_thinking: true,
      ...meta.supportsReasoningEffort === false ? {} : { reasoning_effort: wireLevel },
    }
  }
  return { reasoning_effort: wireLevel }
}

/** Chat Completions body for one request. */
function chatBody(
  options: GenerateOptions,
  messages: readonly TranslatableMessage[],
  meta: OpencodeModelMeta | undefined,
): Record<string, unknown> {
  return {
    model: options.model,
    messages: toChatMessages(messages, options.system),
    ...options.tools !== undefined && options.tools.length > 0
      ? { tools: toChatTools(options.tools), tool_choice: 'auto' }
      : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...opencodeReasoningFields('openai-completions', meta, options.reasoningEffort),
    stream: true,
    stream_options: { include_usage: true },
  }
}

/** Responses body for one request. */
function responsesBody(
  options: GenerateOptions,
  messages: readonly TranslatableMessage[],
  meta: OpencodeModelMeta | undefined,
): Record<string, unknown> {
  const resolved = toResponsesInput(messages, options.system)
  return {
    model: options.model,
    ...resolved.instructions === undefined ? {} : { instructions: resolved.instructions },
    input: resolved.input,
    ...options.tools !== undefined && options.tools.length > 0
      ? { tools: toResponsesTools(options.tools, { strict: false }), tool_choice: 'auto' }
      : {},
    ...options.maxTokens === undefined ? {} : { max_output_tokens: options.maxTokens },
    ...opencodeReasoningFields('openai-responses', meta, options.reasoningEffort),
    stream: true,
  }
}

/** Anthropic Messages body for one request. */
function anthropicBody(
  options: GenerateOptions,
  messages: readonly TranslatableMessage[],
  defaultMaxTokens: number,
  meta: OpencodeModelMeta | undefined,
): Record<string, unknown> {
  return {
    model: options.model,
    max_tokens: options.maxTokens ?? defaultMaxTokens,
    system: toAnthropicSystem(options.system, messages),
    messages: toAnthropicMessages(messages),
    ...options.tools !== undefined && options.tools.length > 0
      ? { tools: toAnthropicTools(options.tools) }
      : {},
    ...opencodeReasoningFields('anthropic-messages', meta, options.reasoningEffort),
    stream: true,
  }
}

/** OpenCode Go wire adapter: one route, per-account keys, three upstream protocols. */
export class OpencodeGoAdapter extends LlmAdapter implements AccountAwareAdapter {
  private readonly listedModels: LlmModelInfo[]

  constructor(private readonly options: OpencodeGoAdapterOptions) {
    super()
    this.listedModels = OPENCODE_MODELS.map(meta => ({
      provider: OPENCODE_PROVIDER_ID,
      id: meta.id,
      name: meta.name,
      inputModalities: meta.input,
    } as LlmModelInfo))
    // Configured-only models (not in the generated catalog) still appear.
    const known = new Set(OPENCODE_MODELS.map(meta => meta.id))
    for (const entry of options.models) {
      if (known.has(entry.id)) continue
      known.add(entry.id)
      this.listedModels.push({
        provider: OPENCODE_PROVIDER_ID,
        id: entry.id,
        name: entry.name ?? entry.id,
        inputModalities: entry.inputModalities ?? ['text'],
      } as LlmModelInfo)
    }
    this.listedModels.sort((left, right) => left.name.localeCompare(right.name))
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: OPENCODE_DISPLAY_NAME }
  }

  override providerRetryPolicy(provider: string) {
    return subscriptionRetryPolicy(
      DEFAULT_RETRY,
      this.options.rateLimit ?? DEFAULT_RATE_LIMIT_WAIT,
      `opencode-go: provider "${provider}" retryPolicy`,
    )
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const own = await this.listOwnModels(provider)
    const pool = this.options.pool?.()
    if (pool === undefined) return own
    const extra = await pool.modelsForProvider(provider as ProviderId)
    const seen = new Set(own.map(model => model.id))
    return [...own, ...extra.filter(model => !seen.has(model.id))]
  }

  async listOwnModels(provider: string, account?: string, _signal?: AbortSignal, _preferCached = false): Promise<readonly LlmModelInfo[]> {
    const accounts = await this.options.tokens.list()
    if (account === undefined ? accounts.length === 0 : !accounts.some(entry => entry.key === account)) return []
    return this.listedModels.map(model => ({ ...model, provider }))
  }

  async lastKnownOwnModels(provider: string, account: string): Promise<readonly LlmModelInfo[] | undefined> {
    return this.listOwnModels(provider, account)
  }

  clearAccountCatalog(_account?: string): void {
    // The catalog is shared by every account: there is nothing per-account to drop.
  }

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const pool = this.options.pool?.()
    if (pool !== undefined && await pool.owns(provider as ProviderId, model)) {
      return pool.resolveModel(provider, model)
    }
    return this.resolveOwnModel(provider, model)
  }

  async resolveOwnModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    const meta = OPENCODE_MODEL_BY_ID.get(model)
    const configured = this.options.models.find(entry => entry.id === model)
    // A configured default effort must fold into the same block exposed to the
    // picker; mergeReasoning drops a configured level the catalog doesn't list.
    const reasoning = mergeReasoning(this.options.defaultEffortOf?.(model), opencodeReasoning(meta))
    return {
      provider,
      id: model,
      name: meta?.name ?? configured?.name ?? model,
      inputModalities: meta?.input ?? configured?.inputModalities ?? ['text'],
      context: { contextWindow: meta?.contextWindow ?? configured?.contextWindow ?? 128_000 },
      defaultMaxTokens: configured?.maxTokens ?? meta?.maxTokens ?? 8_192,
      ...reasoning === undefined ? {} : { reasoning },
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const pool = this.options.pool?.()
    if (pool !== undefined && await pool.owns(options.provider as ProviderId, options.model)) {
      yield* pool.stream(options)
      return
    }
    yield* this.streamCore(options)
  }

  /** Pool seam: stream through one specific account instead of the default. */
  streamAccount(options: GenerateOptions, account: string): AsyncIterable<StreamChunk> {
    return this.streamCore(options, account)
  }

  private metaOf(model: string): OpencodeModelMeta | undefined {
    return OPENCODE_MODEL_BY_ID.get(model)
  }

  private async *streamCore(options: GenerateOptions, account?: string): AsyncIterable<StreamChunk> {
    const watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs)
    try {
      const session = await this.options.tokens.session(account)
      const api = wireOf(options.model, this.options.models.find(entry => entry.id === options.model))
      const meta = this.metaOf(options.model)
      const response = await this.request(options, session, api, meta, watchdog.signal)
      if (response.status === 401 || response.status === 403) {
        // The key is not ours to refresh: keep the account (its label and
        // identity stay visible) and ask the user to replace the key.
        throw new LlmError(
          `OpenCode Go rejected this account's API key (HTTP ${String(response.status)}); `
          + 'replace the key in Settings → Subscriptions',
          'INVALID_CREDENTIAL',
        )
      }
      if (!response.ok) {
        const error = await httpLlmError(response, 'OpenCode Go API', {
          ...this.options.onWarn === undefined ? {} : { onWarn: this.options.onWarn },
        })
        if (response.status === 429 && /GoUsageLimitError|usage limit exceeded/i.test(error.message)) {
          throw new LlmError(
            'OpenCode Go quota exhausted for this account; trying the next pool account',
            'QUOTA',
          )
        }
        throw error
      }
      if (response.body === null) {
        throw new LlmError('OpenCode Go API returned no response body', EMPTY_RESPONSE_CODE)
      }
      const pulse = (): void => { watchdog.pulse() }
      switch (api) {
        case 'openai-completions':
          yield* streamChatCompletions(response.body, pulse)
          return
        case 'openai-responses':
          yield* streamResponses(response.body, pulse)
          return
        case 'anthropic-messages':
          yield* streamAnthropic(response.body, pulse)
          return
        default:
          throw new LlmError(`unsupported OpenCode Go wire "${String(api)}"`, 'INVALID_REQUEST')
      }
    } catch (error: unknown) {
      throw mapFetchFailure('OpenCode Go API', error, watchdog, options.signal)
    } finally {
      watchdog.stop()
    }
  }

  private async request(
    options: GenerateOptions,
    session: OpencodeSession,
    api: OpencodeWire,
    meta: OpencodeModelMeta | undefined,
    signal: AbortSignal,
  ): Promise<Response> {
    const messages = await resolveImages(options.messages, this.options.resolveAttachments?.(), signal)
    const headers: Record<string, string> = {
      authorization: `Bearer ${session.accessToken}`,
      accept: 'text/event-stream',
      'content-type': 'application/json',
      'x-opencode-session': opencodeSessionValue(options.sessionId === undefined ? undefined : String(options.sessionId)),
      ...attributionHeaders(),
    }
    if (api === 'anthropic-messages') headers['anthropic-version'] = '2023-06-01'
    const body = api === 'openai-completions'
      ? chatBody(options, messages, meta)
      : api === 'openai-responses'
        ? responsesBody(options, messages, meta)
        : anthropicBody(options, messages, meta?.maxTokens ?? 8_192, meta)
    const fetchFn = this.options.fetchFn ?? proxiedFetch
    const target = requestUrl(api, this.options.baseURL())
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body), signal }
    return fetchFn(target, init)
  }
}

/** One OpenCode Go usage window from the gateway response. */
interface OpencodeUsageWindow {
  status: 'ok' | 'rate-limited'
  percent: number
  resetsAt: string
}

/** Parse and validate the gateway usage response. */
export function parseOpencodeUsage(value: unknown): ProviderUsage {
  const usage = (value as { usage?: unknown } | null)?.usage
  const source = (usage ?? value) as Record<string, unknown> | null
  if (source === null || typeof source !== 'object') {
    throw new LlmError('OpenCode Go usage response is invalid', 'PROVIDER_ERROR')
  }
  const windows: UsageWindow[] = []
  const rows: readonly [string, UsageWindow['kind'], string | undefined][] = [
    ['rolling', 'session', undefined],
    ['weekly', 'weekly', undefined],
    ['monthly', 'other', 'monthly'],
  ]
  for (const [field, kind, scope] of rows) {
    const row = source[field] as Partial<OpencodeUsageWindow> | undefined
    if (row === undefined) continue
    if ((row.status !== 'ok' && row.status !== 'rate-limited')
      || typeof row.percent !== 'number' || !Number.isFinite(row.percent)
      || typeof row.resetsAt !== 'string') {
      throw new LlmError('OpenCode Go usage response is invalid', 'PROVIDER_ERROR')
    }
    const resetsAt = Date.parse(row.resetsAt)
    windows.push({
      kind,
      ...scope === undefined ? {} : { scope },
      usedPercent: Math.max(0, Math.min(100, row.percent)),
      ...Number.isFinite(resetsAt) ? { resetsAt } : {},
    })
  }
  if (windows.length === 0) throw new LlmError('OpenCode Go usage response is invalid', 'PROVIDER_ERROR')
  return { supported: true, windows }
}

/** Read one account's subscription usage from the gateway. */
export async function fetchOpencodeUsage(
  session: OpencodeSession,
  baseURL: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = proxiedFetch,
): Promise<ProviderUsage> {
  const response = await fetchFn(opencodeUsageUrl(baseURL), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      accept: 'application/json',
      ...attributionHeaders(),
    },
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) throw await httpLlmError(response, 'OpenCode Go usage')
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new LlmError('OpenCode Go usage response is invalid', 'PROVIDER_ERROR')
  }
  return parseOpencodeUsage(body)
}
