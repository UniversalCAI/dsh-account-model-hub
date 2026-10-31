/** Selectable reasoning levels and request fields for the OpenCode Go route. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import {
  DEFAULT_OPENCODE_BASE_URL,
  OpencodeGoAdapter,
  opencodeReasoning,
  opencodeReasoningFields,
} from '../src/providers/opencode.js'
import { OPENCODE_MODEL_BY_ID } from '../src/providers/opencode-models.js'

/** Minimal adapter; resolveOwnModel reads only the static catalog. */
function adapter(defaultEffort?: string): OpencodeGoAdapter {
  return new OpencodeGoAdapter({
    tokens: {} as never,
    models: [],
    baseURL: () => DEFAULT_OPENCODE_BASE_URL,
    streamIdleTimeoutMs: 1000,
    ...defaultEffort === undefined ? {} : { defaultEffortOf: () => defaultEffort },
  })
}

test('OpenCode models publish the thinking levels their catalog maps', () => {
  assert.deepEqual(
    opencodeReasoning(OPENCODE_MODEL_BY_ID.get('deepseek-v4.1-flash'))?.efforts.map(effort => String(effort.id)),
    ['low', 'high', 'max'],
    'explicit null levels are hidden and max is selectable',
  )
  assert.deepEqual(
    opencodeReasoning(OPENCODE_MODEL_BY_ID.get('gpt-5.6-luna'))?.efforts.map(effort => String(effort.id)),
    ['low', 'medium', 'high', 'xhigh', 'max'],
  )
  assert.deepEqual(
    opencodeReasoning(OPENCODE_MODEL_BY_ID.get('qwen3.8-flash'))?.efforts.map(effort => String(effort.id)),
    ['off', 'minimal', 'low', 'medium', 'high'],
    'a reasoning model without a level map gets pi-ai default levels',
  )
  assert.equal(opencodeReasoning(undefined), undefined)
})

test('resolveModel exposes the reasoning block to the picker', async () => {
  const resolved = await adapter().resolveOwnModel('opencode-go-hub', 'deepseek-v4.1-flash')
  assert.deepEqual(
    resolved.reasoning?.efforts.map(effort => String(effort.id)),
    ['low', 'high', 'max'],
  )
  assert.equal(resolved.reasoning?.defaultEffort, undefined)

  const configured = await adapter('high').resolveOwnModel('opencode-go-hub', 'deepseek-v4.1-flash')
  assert.equal(String(configured.reasoning?.defaultEffort), 'high')
})

test('request fields encode each OpenCode wire correctly', () => {
  const deepseek = OPENCODE_MODEL_BY_ID.get('deepseek-v4-flash')
  const glm = OPENCODE_MODEL_BY_ID.get('glm-5.3')
  const qwen = OPENCODE_MODEL_BY_ID.get('qwen3.6-plus')
  const luna = OPENCODE_MODEL_BY_ID.get('gpt-5.6-luna')
  const qwenAnthropic = OPENCODE_MODEL_BY_ID.get('qwen3.8-flash')

  assert.deepEqual(
    opencodeReasoningFields('openai-completions', deepseek, ReasoningEffortId('high')),
    { thinking: { type: 'enabled' }, reasoning_effort: 'high' },
  )
  assert.deepEqual(
    opencodeReasoningFields('openai-completions', deepseek, ReasoningEffortId('off')),
    { thinking: { type: 'disabled' } },
  )
  assert.deepEqual(
    opencodeReasoningFields('openai-completions', glm, ReasoningEffortId('high')),
    { reasoning_effort: 'high' },
  )
  assert.deepEqual(
    opencodeReasoningFields('openai-completions', qwen, ReasoningEffortId('low')),
    { enable_thinking: true, reasoning_effort: 'low' },
  )
  assert.deepEqual(
    opencodeReasoningFields('openai-responses', luna, ReasoningEffortId('xhigh')),
    { reasoning: { effort: 'xhigh' } },
  )
  assert.deepEqual(
    opencodeReasoningFields('anthropic-messages', qwenAnthropic, ReasoningEffortId('high')),
    { thinking: { type: 'enabled', budget_tokens: 16384 } },
  )
  assert.deepEqual(
    opencodeReasoningFields('openai-completions', glm, undefined),
    {},
  )
})
