import type { GtmContext } from '../companyAnalysis/confidence.ts';
import type { JsonSchema, TextModel } from './model.ts';

// What kind of company we're writing to. This sets the email's angle more
// than anything else, since it decides who's actually filing the tickets.
export const SEGMENTS = ['operator', 'supplier', 'affiliate', 'payments', 'unknown'] as const;
export type Segment = (typeof SEGMENTS)[number];

export type Classification = { ok: true; segment: Segment } | { ok: false; reason: string };

// The model does this instead of keyword rules. Keywords broke on B2B vendors
// that name their customers ("a fraud vendor for sportsbooks") and on
// companies that do more than one thing.
const INSTRUCTIONS = `Classify a company in the iGaming and sports betting ecosystem by who files its support tickets.
- operator: B2C sportsbooks, casinos, lotteries, betting apps. Players file the tickets.
- supplier: B2B companies that sell to operators: platforms, odds and data feeds, game studios, KYC, fraud, risk, geolocation, and compliance vendors. Naming sportsbooks or casinos as customers does not make a company an operator.
- affiliate: comparison, review, tipster, or lead gen businesses. Partners file the tickets.
- payments: payment processors, PSPs, wallets, payout and on-ramp providers.
- unknown: the description doesn't say enough to tell.
If a company does more than one of these, pick the one that drives most of its support volume.`;

const SCHEMA: JsonSchema = {
  name: 'company_segment',
  schema: {
    type: 'object',
    properties: { segment: { type: 'string', enum: [...SEGMENTS] } },
    required: ['segment'],
    additionalProperties: false,
  },
};

const isSegment = (value: unknown): value is Segment => SEGMENTS.some((s) => s === value);

/**
 * Never throws. A failed classification just means we fall back to the
 * helper, and the caller reports the reason.
 */
export async function classifySegment(description: string, model: TextModel): Promise<Classification> {
  try {
    const raw = await model.completeJson({ instructions: INSTRUCTIONS, input: description }, SCHEMA);
    const segment = typeof raw === 'object' && raw !== null && 'segment' in raw ? raw.segment : undefined;
    return isSegment(segment)
      ? { ok: true, segment }
      : { ok: false, reason: `unexpected classifier output: ${JSON.stringify(raw)}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// The helper's labels don't map 1:1 onto ours ("platform" covers a lot).
const HELPER_TYPE_TO_SEGMENT: Record<string, Segment> = {
  operator: 'operator',
  platform: 'supplier',
  supplier: 'supplier',
  b2b: 'supplier',
  vendor: 'supplier',
  affiliate: 'affiliate',
  payments: 'payments',
  psp: 'payments',
};

/**
 * The description wins: a person wrote it, and the helper gets this wrong
 * sometimes (it calls ApexPay, a payments provider, a "platform"). The helper
 * only fills in when the description is too vague, and only at high
 * confidence. The angle gets stated as fact, so a medium-confidence guess
 * shouldn't drive it.
 */
export function resolveSegment(classification: Classification, gtm: GtmContext): Segment {
  if (classification.ok && classification.segment !== 'unknown') return classification.segment;
  if (gtm.tier === 'high' && gtm.facts.companyType) {
    return HELPER_TYPE_TO_SEGMENT[gtm.facts.companyType.toLowerCase()] ?? 'unknown';
  }
  return 'unknown';
}
