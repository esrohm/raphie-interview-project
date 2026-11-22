import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GtmContext } from '../companyAnalysis/confidence.ts';
import type { TextModel } from './model.ts';
import { classifySegment, resolveSegment } from './segment.ts';

const jsonModel = (reply: () => Promise<unknown>): TextModel => ({
  complete: () => Promise.reject(new Error('not used here')),
  completeJson: reply,
});
const replying = (value: unknown) => () => Promise.resolve(value);

const NONE: GtmContext = { tier: 'none', reason: 'test' };
const helper = (tier: 'high' | 'medium', companyType: string): GtmContext =>
  tier === 'high'
    ? {
        tier,
        confidence: 0.9,
        facts: { companyType, likelyTicketDrivers: [], operatingRegions: [], complianceThemes: [] },
      }
    : { tier, confidence: 0.5, facts: { companyType, likelyTicketDrivers: [] } };

test('classifySegment returns what the model picked', async () => {
  const result = await classifySegment('A payments provider', jsonModel(replying({ segment: 'payments' })));
  assert.deepEqual(result, { ok: true, segment: 'payments' });
});

test('classifySegment rejects output outside the schema and model errors', async () => {
  for (const reply of [replying({ segment: 'casino' }), replying('payments'), replying(null)]) {
    const result = await classifySegment('x', jsonModel(reply));
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /unexpected classifier output/);
  }
  const failed = await classifySegment(
    'x',
    jsonModel(() => Promise.reject(new Error('timeout'))),
  );
  assert.deepEqual(failed, { ok: false, reason: 'timeout' });
});

test('the description wins over the helper', () => {
  // the helper calls ApexPay a "platform", the description says payments
  assert.equal(resolveSegment({ ok: true, segment: 'payments' }, helper('high', 'platform')), 'payments');
});

test('the helper only fills in for a vague description, and only at high confidence', () => {
  const vague = { ok: true, segment: 'unknown' } as const;
  const failed = { ok: false, reason: 'timeout' } as const;
  assert.equal(resolveSegment(vague, helper('high', 'platform')), 'supplier');
  assert.equal(resolveSegment(failed, helper('high', 'Operator')), 'operator');
  // a medium-confidence guess would end up stated as fact in the angle
  assert.equal(resolveSegment(vague, helper('medium', 'operator')), 'unknown');
  assert.equal(resolveSegment(failed, NONE), 'unknown');
  assert.equal(resolveSegment(vague, helper('high', 'general_business')), 'unknown');
});
