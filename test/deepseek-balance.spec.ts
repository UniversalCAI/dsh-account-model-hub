/** DeepSeek official balance normalization for the footer header. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { balanceSymbol, normalizeDeepSeekBalance } from '../src/client/deepseek-balance.js'

test('sums topped-up and bonus wallets and prefers CNY', () => {
  const balance = normalizeDeepSeekBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '5.00' }, { currency: 'USD', balance: '1.00' }],
    bonusWallets: [{ currency: 'CNY', balance: '0.99' }],
  })
  assert.deepEqual(balance, { currency: 'CNY', total: 5.99, granted: 0.99, toppedUp: 5 })
})

test('rejects non-ready, malformed and empty wallet payloads', () => {
  assert.equal(normalizeDeepSeekBalance(undefined), undefined)
  assert.equal(normalizeDeepSeekBalance({ status: 'failed' }), undefined)
  assert.equal(normalizeDeepSeekBalance({ status: 'ready', value: [{ currency: 'EUR', balance: '1' }], bonusWallets: [] }), undefined)
  assert.equal(normalizeDeepSeekBalance({ status: 'ready', value: [{ currency: 'CNY', balance: 'x' }], bonusWallets: [] }), undefined)
  assert.equal(normalizeDeepSeekBalance({ status: 'ready', value: [], bonusWallets: [] }), undefined)
})

test('balance currency symbols', () => {
  assert.equal(balanceSymbol('CNY'), '¥')
  assert.equal(balanceSymbol('USD'), '$')
})
