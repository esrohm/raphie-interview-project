import type { CompanyAnalysis } from './client.ts';

// How much of the helper response we let into the prompt, based on confidence.
//
// The reasoning: a wrong detail in a cold email is worse than a missing one.
// If we tell a payments company "your players keep asking about bet
// settlement", they'll know right away it's a template, and that's exactly the
// "feels AI-generated" problem Raphie wants to avoid. The description comes
// from a human who actually looked at the company, so it's the source of truth
// and the helper is there to fill in gaps.
//
//   >= 0.7       high: use the full analysis, regions and compliance included.
//   0.4 to 0.7   medium: only the broad strokes (what kind of company, what
//                the tickets probably look like), framed as "likely", and the
//                description wins on any conflict. The detailed fields are
//                where a shaky guess does the most damage, so they get dropped.
//   < 0.4        none: ignore it completely and write from the description.
//
// The cutoffs are judgment calls, not something I measured. When I tested,
// well known names came back at 0.77 and 0.99 and a made-up company came back
// at 0.14 labelled "general_business". ApexPay came back at 0.69 as a
// "platform" even though the example describes it as a payments provider,
// which is pretty much the case the medium tier is for.

export const HIGH_CONFIDENCE = 0.7;
export const MIN_CONFIDENCE = 0.4;

// Past a handful of items it stops reading like someone who knows the company
// and starts reading like a feature list.
const MAX_TICKET_DRIVERS = 4;
const MAX_COMPLIANCE_THEMES = 3;

export interface BroadFacts {
  vertical?: string;
  companyType?: string;
  supportMotion?: string;
  likelyTicketDrivers: string[];
}

export interface DetailedFacts extends BroadFacts {
  operatingRegions: string[];
  complianceThemes: string[];
  // only set when it's actually worth mentioning, see below
  isCryptoRelated?: true;
  kycAmlIntensity?: string;
}

export type GtmContext =
  | { tier: 'high'; confidence: number; facts: DetailedFacts }
  | { tier: 'medium'; confidence: number; facts: BroadFacts }
  | { tier: 'none'; reason: string };

function broadFacts(a: CompanyAnalysis): BroadFacts {
  return {
    vertical: a.vertical,
    companyType: a.companyType,
    supportMotion: a.supportMotion,
    likelyTicketDrivers: a.likelyTicketDrivers.slice(0, MAX_TICKET_DRIVERS),
  };
}

export function toGtmContext(analysis: CompanyAnalysis | null): GtmContext {
  if (!analysis) {
    return { tier: 'none', reason: 'no helper data' };
  }

  const { confidence } = analysis;

  if (confidence < MIN_CONFIDENCE) {
    return { tier: 'none', reason: `confidence ${confidence.toFixed(2)} is below ${MIN_CONFIDENCE}` };
  }

  if (confidence < HIGH_CONFIDENCE) {
    return { tier: 'medium', confidence, facts: broadFacts(analysis) };
  }

  return {
    tier: 'high',
    confidence,
    facts: {
      ...broadFacts(analysis),
      operatingRegions: analysis.operatingRegions,
      complianceThemes: analysis.complianceThemes.slice(0, MAX_COMPLIANCE_THEMES),
      // "not crypto related" doesn't give the email anything to say, so we
      // only pass this along when it's true
      isCryptoRelated: analysis.isCryptoRelated === true ? true : undefined,
      // same idea, low KYC intensity isn't a selling point. Lowercased first
      // since nothing promises the endpoint won't send "High".
      kycAmlIntensity: analysis.kycAmlIntensity?.toLowerCase() === 'high' ? 'high' : undefined,
    },
  };
}
