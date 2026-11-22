import type { GtmContext } from '../companyAnalysis/confidence.ts';

export type Tone = 'direct' | 'warm';

export interface EmailRequest {
  recipientName: string;
  companyName: string;
  description: string;
  tone: Tone;
}

export interface Prompt {
  // stable stuff: who we are, the rules, tone, style references
  instructions: string;
  // per-email stuff: recipient, company, and what we know about them
  input: string;
}

// What kind of company we're writing to. This drives the angle of the email
// more than anything else, since an operator's support problems (players,
// withdrawals, game day spikes) look nothing like an affiliate's.
export type Segment = 'operator' | 'supplier' | 'affiliate' | 'payments' | 'unknown';

// Checked in order, and order matters: "a payments provider for iGaming
// operators" mentions operators, but it's obviously a payments company.
// Same for "a platform that powers sportsbooks".
const SEGMENT_KEYWORDS: Array<[Segment, RegExp]> = [
  ['payments', /\b(payments?|psp|payouts? provider|processor|acquir\w*|on-?ramps?|e-?wallets?)\b/i],
  ['affiliate', /\b(affiliates?|comparison site|review site|tipsters?|lead gen\w*|media brand)\b/i],
  [
    'supplier',
    /\b(b2b|suppliers?|platform provider|white[- ]label|aggregator|odds (feed|provider)|data provider|game (studio|provider)|kyc provider|risk (vendor|platform)|compliance (vendor|platform)|powers)\b/i,
  ],
  [
    'operator',
    /\b(sportsbooks?|casinos?|operators?|bookmakers?|betting (app|site|brand)|lotter(y|ies)|igaming brand)\b/i,
  ],
];

// The helper's labels don't map 1:1 onto ours ("platform" covers a lot), so
// this is a loose translation.
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
 * The description wins when it clearly says what the company is. A person
 * wrote it, and the helper sometimes gets this wrong (it called ApexPay, a
 * payments provider, a "platform" even at 0.8 confidence). The helper only
 * breaks the tie when the description is vague.
 */
export function inferSegment(description: string, gtm: GtmContext): Segment {
  for (const [segment, pattern] of SEGMENT_KEYWORDS) {
    if (pattern.test(description)) return segment;
  }
  if (gtm.tier !== 'none' && gtm.facts.companyType) {
    return HELPER_TYPE_TO_SEGMENT[gtm.facts.companyType.toLowerCase()] ?? 'unknown';
  }
  return 'unknown';
}

// The angle for each kind of company: who's actually filing the tickets, and
// what Raphie's pitch should lean on for them.
const SEGMENT_ANGLES: Record<Segment, string> = {
  operator:
    'This is a B2C operator. Their tickets come from players: withdrawals, verification, promo and bonus questions, account access, bet settlement. ' +
    'Volume spikes around big events. Lean on containment of repetitive player questions, consistent policy-aware answers, and clean escalation for sensitive cases.',
  supplier:
    'This is a B2B supplier or platform. Their "customers" are operators, so tickets are fewer but higher stakes: integration issues, incidents, configuration and account questions. ' +
    'Lean on faster first response, routing the right ticket to the right specialist, and helping agents answer technical questions consistently. Avoid talking about players as if they were their customers.',
  affiliate:
    'This is an affiliate or media business. Support is mostly partner-facing: commission and payout questions, tracking and attribution disputes, onboarding. ' +
    'Lean on automating the repetitive partner questions and freeing the team for relationships. Do not pitch it like a high-volume player support operation.',
  payments:
    'This is a payments company in the gaming space. Demand usually comes from two sides: operators who need fast answers, and end users asking about payout status, failed deposits, or reviews. ' +
    'Lean on deflecting status-check tickets, guiding agents, and keeping approvals and audit trails intact for higher-risk cases.',
  unknown:
    'The type of company is not clear. Stay grounded in what the description says and keep the pitch general: deflecting repetitive tickets, faster resolution, helping agents.',
};

export const TONE_GUIDES: Record<Tone, { guide: string; signOff: string }> = {
  direct: {
    guide:
      'Direct: get to the point in the first sentence after the greeting. No small talk. Confident and plain, around 90 to 130 words.',
    signOff: 'Best, Raphie',
  },
  warm: {
    guide:
      "Warm: open with one short friendly line, then get into it. It's a cold email, so the opener can't assume they know us or have read anything. Conversational and human, never gushing. Around 110 to 150 words.",
    signOff: 'Warm regards, Raphie',
  },
};

// Short notes on what a region usually means for support. Only used when the
// helper is confident, and only for regions where there's something real to say.
const REGION_NOTES: Record<string, string> = {
  US: 'US: state-by-state licensing, geolocation checks, and strict KYC',
  CA: 'Canada: provincial regulation, Ontario in particular',
  UK: 'UK: UKGC affordability and responsible gambling checks',
  EU: 'EU: GDPR and a patchwork of national licenses',
  LATAM: 'LATAM: newly regulated markets and a lot of local payment methods',
};

// The two examples from the brief, trimmed so every sentence fits under the
// 30 word limit. The originals both have 32-33 word sentences, and if we show
// the model those it'll copy the habit.
export const STYLE_EXAMPLES = [
  `Hi Jane,
I'm reaching out from Raphie. We help support teams automate high-volume workflows like verification, withdrawals, promo eligibility, and account access, with clean handoffs to agents when a case needs review.
Riverline deals with a lot of customer-facing volume, plus the operational complexity of US requirements. Small cuts in handle time and repeat tickets can make a real difference to cost and player experience. Raphie focuses on fast containment for common questions, consistent policy-aware replies, and escalation paths that keep sensitive cases auditable.
Would you be open to a quick 15-minute call next week to see if this could be useful?
Best, Raphie`,
  `Hi Jane,
Hope you're doing well. I'm reaching out from Raphie because we work with support teams in fast-moving, compliance-heavy environments where payouts, fraud reviews, and identity checks create a steady stream of time-sensitive tickets.
From the outside, ApexPay Gaming looks like a business where support demand comes from two sides. Operators need fast answers, and players ask about payout status, settlement timing, or wallet issues. Raphie automates the repetitive workflows, guides agents with suggested replies, and keeps approvals in place for higher-risk cases. That way your team can move quickly without losing control of the process.
Would you be open to a short conversation to see whether this could help reduce ticket volume and improve response times?
Warm regards, Raphie`,
];

// "account_access" -> "account access"
const humanize = (value: string) => value.replace(/_/g, ' ');

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function describeGtm(gtm: GtmContext): string {
  if (gtm.tier === 'none') {
    // Say nothing about the helper at all. Telling the model "we don't know
    // much" tends to make it pad the email with vague filler.
    return '';
  }

  const { facts } = gtm;
  const lines: string[] = [];
  if (facts.vertical) lines.push(`Vertical: ${humanize(facts.vertical)}`);
  if (facts.companyType) lines.push(`Company type: ${humanize(facts.companyType)}`);
  if (facts.supportMotion) lines.push(`Support motion: ${humanize(facts.supportMotion)}`);
  if (facts.likelyTicketDrivers.length > 0) {
    lines.push(`Likely ticket drivers: ${facts.likelyTicketDrivers.map(humanize).join(', ')}`);
  }

  if (gtm.tier === 'medium') {
    return [
      'Background research (moderate confidence, treat these as educated guesses):',
      ...lines.map((l) => `- ${l}`),
      'Only use these where they agree with the description. If anything conflicts, trust the description.',
      'Phrase anything from here softly ("teams like yours often see..."), never as a stated fact about them.',
    ].join('\n');
  }

  // past the medium check, so TS knows these are the detailed facts
  const detailed = gtm.facts;
  const regionNotes = detailed.operatingRegions
    .map((r) => REGION_NOTES[r.toUpperCase()])
    .filter((note): note is string => note !== undefined);
  if (regionNotes.length > 0) lines.push(`Regions: ${regionNotes.join('; ')}`);
  if (detailed.complianceThemes.length > 0) {
    lines.push(`Compliance themes: ${detailed.complianceThemes.map(humanize).join(', ')}`);
  }
  if (detailed.kycAmlIntensity) lines.push(`KYC/AML intensity: ${detailed.kycAmlIntensity}`);
  if (detailed.isCryptoRelated) lines.push('Crypto: yes, expect wallet and on-chain payout questions');

  return [
    'Background research (high confidence):',
    ...lines.map((l) => `- ${l}`),
    'Pick the one or two details that matter most for this company and work them in naturally. Do not list them all.',
    'If the description says something different, the description is right.',
  ].join('\n');
}

export function buildPrompt(req: EmailRequest, gtm: GtmContext): Prompt {
  const segment = inferSegment(req.description, gtm);
  const tone = TONE_GUIDES[req.tone];

  const instructions = `You write cold outreach emails for Raphie, a company that automates customer support for businesses in iGaming and sports betting.
You write like an experienced, plain-spoken salesperson who knows the industry. The email must not read as AI-generated.

Every email must:
- Greet the recipient by first name ("Hi <first name>,").
- Mention the company by its full name at least once.
- Say why this company's space is a strong fit for support automation, based on what we know about them.
- Make Raphie's value clear by touching on all four of these, even briefly: automating support workflows, faster resolution times, deflecting repetitive tickets, and helping agents. This is a checklist, not a menu to pick from.
- End with a low-pressure ask for a short call.
- Sign off exactly with: ${tone.signOff}

Hard rules. Breaking any of these means the email gets thrown out:
- Never use em dashes. Split the thought into two sentences or use a colon. Don't just swap in a comma, that makes a run-on.
- Never start a sentence with "Furthermore" or "Additionally".
- Never use the word "fantastic".
- No more than one exclamation mark in the whole email. Zero is better.
- Two sentences in a row must never start with the same word. Watch out for "Raphie" and "We" back to back.
- Keep every sentence under 25 words.

Avoid the usual cold email clichés: "I hope this email finds you well", "in today's fast-paced world", "game-changer", "revolutionize", "leverage", "seamless".
Also avoid stock framings like "X sits in a support-heavy spot" or "X sits right in the middle of". Say the specific thing about their support instead.
Do not invent numbers, customers, or results.

Tone:
${tone.guide}

Here are two emails in the style we want. Use them for voice and structure only. Do not copy their phrasing.

${STYLE_EXAMPLES.map((e, i) => `Example ${i + 1}:\n${e}`).join('\n\n')}

Reply with the email text only: no subject line, no notes, no markdown.`;

  const research = describeGtm(gtm);
  const input = [
    `Recipient: ${req.recipientName} (first name: ${firstName(req.recipientName)})`,
    `Company: ${req.companyName}`,
    `Description: ${req.description}`,
    '',
    `Angle: ${SEGMENT_ANGLES[segment]}`,
    research ? `\n${research}` : '',
  ]
    .join('\n')
    .trim();

  return { instructions, input };
}
