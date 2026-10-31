/**
 * Circular quota model tests: fixed ring slots, window→ring mapping, default
 * smallest-window selection, remaining-percent inversion and reset labels.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  QUOTA_LAYERS,
  defaultQuotaLayer,
  formatQuotaReset,
  quotaWindowForLayer,
  quotaWindowsByLayer,
  remainingPercent,
} from '../src/client/quota-model.js'
import type { UsageWindow } from '../src/client/SubscriptionsSection.js'

const session = (used: number, reset?: number): UsageWindow => ({ kind: 'session', usedPercent: used, ...reset === undefined ? {} : { resetsAt: reset } })
const weekly = (used: number, reset?: number): UsageWindow => ({ kind: 'weekly', usedPercent: used, ...reset === undefined ? {} : { resetsAt: reset } })
const monthly = (used: number, reset?: number): UsageWindow => ({ kind: 'other', scope: 'monthly', usedPercent: used, ...reset === undefined ? {} : { resetsAt: reset } })

test('fixed slots are 5h, weekly, monthly in display order', () => {
  assert.deepEqual(QUOTA_LAYERS.map(layer => layer.id), ['session', 'weekly', 'monthly'])
  assert.equal(new Set(QUOTA_LAYERS.map(layer => layer.shortLabelKey)).size, 3)
})

test('OpenCode Go maps all three windows; GPT weekly-only leaves two slots empty', () => {
  const opencode = quotaWindowsByLayer([session(12), weekly(56), monthly(28)])
  assert.equal(opencode.size, 3)
  assert.equal(quotaWindowForLayer([session(12), weekly(56), monthly(28)], 'monthly')?.usedPercent, 28)
  const gpt = quotaWindowsByLayer([weekly(28)])
  assert.deepEqual([...gpt.keys()], ['weekly'])
  assert.equal(quotaWindowForLayer([weekly(28)], 'session'), undefined)
  assert.equal(quotaWindowForLayer([weekly(28)], 'monthly'), undefined)
})

test('default layer is the smallest reported unit', () => {
  assert.equal(defaultQuotaLayer(quotaWindowsByLayer([session(12), weekly(56), monthly(28)])), 'session')
  assert.equal(defaultQuotaLayer(quotaWindowsByLayer([weekly(28)])), 'weekly')
  assert.equal(defaultQuotaLayer(quotaWindowsByLayer([monthly(20)])), 'monthly')
  assert.equal(defaultQuotaLayer(new Map()), undefined)
})

test('rings show remaining quota, not used quota', () => {
  assert.equal(remainingPercent(session(12)), 88)
  assert.equal(remainingPercent(weekly(100)), 0)
  assert.equal(remainingPercent(monthly(0)), 100)
  assert.equal(remainingPercent({ kind: 'session', usedPercent: 150 }), 0)
  assert.equal(remainingPercent({ kind: 'session', usedPercent: -5 }), 100)
})

test('reset labels are compact MM/DD HH:mm', () => {
  const at = new Date(2026, 9, 30, 10, 41).getTime()
  assert.equal(formatQuotaReset(at), '10/30 10:41')
  assert.equal(formatQuotaReset(Number.NaN), '')
})
