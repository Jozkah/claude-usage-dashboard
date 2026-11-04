import assert from 'node:assert/strict';
import test from 'node:test';
import { priceFor, costOf } from './pricing.js';

test('matches published base and cache read prices per million tokens', () => {
  const cases = [
    ['claude-fable-5-1', 10, 50, 0.25],
    ['claude-fable-5', 10, 50, 1],
    ['claude-mythos-5-1', 10, 50, 0.25],
    ['claude-mythos-5', 10, 50, 1],
    ['claude-opus-5-5', 4, 20, 0.2],
    ['claude-opus-5', 5, 25, 0.5],
    ['claude-opus-4-8', 5, 25, 0.5],
    ['claude-opus-4-1-20250805', 15, 75, 1.5],
    ['claude-sonnet-5-5', 2, 10, 0.1],
    ['claude-sonnet-5', 2, 10, 0.2],
    ['claude-sonnet-4-6', 3, 15, 0.3],
    ['claude-haiku-4-5-20251001', 1, 5, 0.1],
    ['claude-haiku-3-5-20241022', 0.8, 4, 0.08],
  ];
  for (const [model, input, output, cacheRead] of cases) {
    const price = priceFor(model);
    assert.ok(price, model);
    assert.equal(costOf(price, { in: 1e6, out: 0, cr: 0, c5: 0, c1: 0 }), input, model);
    assert.equal(costOf(price, { in: 0, out: 1e6, cr: 0, c5: 0, c1: 0 }), output, model);
    assert.equal(costOf(price, { in: 0, out: 0, cr: 1e6, c5: 0, c1: 0 }), cacheRead, model);
  }
});

test('Haiku 5.5 uses higher rates when request prompt exceeds 100k tokens', () => {
  const price = priceFor('claude-haiku-5-5');
  assert.equal(costOf(price, { in: 100000, out: 100000, cr: 0, c5: 0, c1: 0 }), 0.06);
  assert.equal(costOf(price, { in: 100001, out: 100000, cr: 0, c5: 0, c1: 0 }), 0.3000005);
  assert.equal(costOf(price, { in: 0, out: 0, cr: 100001, c5: 0, c1: 0 }), 0.00500005);
});

test('prices dated base IDs, legacy 3.x names and context suffixes', () => {
  const cases = [
    ['claude-opus-4-20250514', 15, 75], ['claude-sonnet-4-20250514', 3, 15],
    ['claude-opus-4-1-20250805', 15, 75], ['claude-opus-4-6[1m]', 5, 25],
    ['claude-3-5-sonnet-20241022', 3, 15], ['claude-3-opus-20240229', 15, 75],
    ['claude-3-7-sonnet-20250219', 3, 15], ['claude-3-haiku-20240307', 0.25, 1.25],
    ['claude-3-5-haiku-20241022', 0.8, 4], ['anthropic.claude-3-5-sonnet-20241022-v2:0', 3, 15],
  ];
  for (const [model, i, o] of cases) {
    const price = priceFor(model);
    assert.ok(price, model);
    assert.equal(price.i, i, model);
    assert.equal(price.o, o, model);
  }
});

test('Sonnet 4.x 1M context is billed at the long-prompt rate above 200k prompt tokens', () => {
  const price = priceFor('claude-sonnet-4-5');
  assert.equal(costOf(price, { in: 200000, out: 1e6, cr: 0, c5: 0, c1: 0 }), 0.6 + 15);
  assert.equal(costOf(price, { in: 200001, out: 1e6, cr: 0, c5: 0, c1: 0 }), 200001 * 6 / 1e6 + 22.5);
  // aggregated usage can state the per-request prompt size explicitly
  assert.equal(costOf(price, { in: 1000, out: 0, cr: 0, c5: 0, c1: 0, prompt: 300000 }), 0.006);
});

test('cost components: cache writes alone, batch with fast mode, unknown model search only', () => {
  const price = priceFor('claude-opus-5-5');
  assert.equal(costOf(price, { in: 0, out: 0, cr: 0, c5: 1e6, c1: 0 }), 4 * 1.25);
  assert.equal(costOf(price, { in: 0, out: 0, cr: 0, c5: 0, c1: 1e6 }), 4 * 2);
  assert.equal(costOf(price, { in: 1e6, out: 0, cr: 0, c5: 0, c1: 0, speed: 'fast', tier: 'batch' }), 8 * 0.5);
  assert.equal(costOf(null, { in: 1e6, out: 1e6, cr: 0, c5: 0, c1: 0, search: 3 }), 0.03);
  assert.equal(priceFor('<synthetic>'), null);
});

test('unknown model stays unpriced', () => {
  assert.equal(priceFor('pxa-27b'), null);
  assert.equal(priceFor('claude-opus-6'), null);
});

test('applies fast mode, US inference, cache writes, and web search pricing', () => {
  const price = priceFor('claude-opus-5-5');
  const usage = { in: 1e6, out: 1e6, cr: 1e6, c5: 1e6, c1: 1e6, speed: 'fast', geo: 'us', search: 2 };
  // Fast Opus 5.5: 8 input, 40 output; cache read 0.05x, writes 1.25x and 2x.
  // US inference adds 10%; two web searches cost $0.02.
  assert.equal(costOf(price, usage), (8 + 40 + 0.4 + 10 + 16) * 1.1 + 0.02);
});

test('applies batch discount to token charges when recorded', () => {
  const price = priceFor('claude-sonnet-5');
  assert.equal(costOf(price, { in: 1e6, out: 1e6, cr: 0, c5: 0, c1: 0, tier: 'batch' }), 6);
});
