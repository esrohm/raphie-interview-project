// Runs a set of company profiles through the real pipeline (helper endpoint +
// OpenAI) and reports how the drafts did against the rules. The unit tests
// use a fake model, so this is the only thing that tells us whether a prompt
// change actually made the emails better or worse.
//
//   npm run eval                 one run per case
//   npm run eval -- --runs 3     more runs, since output varies between calls
//   npm run eval -- --show       also print every email
//
// Costs real API calls, so it's not part of `npm run check` or CI.

import { parseArgs } from 'node:util';
import { fetchCompanyAnalysis } from '../src/companyAnalysis/client.ts';
import { toGtmContext } from '../src/companyAnalysis/confidence.ts';
import { loadConfig } from '../src/config.ts';
import { generateEmail } from '../src/email/generate.ts';
import { createOpenAIModel } from '../src/email/openaiModel.ts';
import { inferSegment, type EmailRequest } from '../src/email/prompt.ts';
import { splitSentences } from '../src/email/rules.ts';

// The two examples from the brief, the CLI example from the brief, plus one of
// each segment the brief mentions that the examples don't cover, and a vague
// one to exercise the low-information path.
const CASES: Array<{ label: string; req: EmailRequest }> = [
  {
    label: 'operator (brief #1)',
    req: {
      recipientName: 'Jane Doe',
      companyName: 'Riverline Sportsbook',
      description:
        'A sportsbook operator with high withdrawal volume, KYC questions, promo eligibility disputes, and periodic support spikes on big game days',
      tone: 'direct',
    },
  },
  {
    label: 'payments (brief #2)',
    req: {
      recipientName: 'Jane Doe',
      companyName: 'ApexPay Gaming',
      description:
        'A payments provider for iGaming operators that supports card, ACH, and crypto on-ramps, and handles a high volume of payout status and fraud review tickets from operators and end users',
      tone: 'warm',
    },
  },
  {
    label: 'operator (brief CLI example)',
    req: {
      recipientName: 'Alex Gould',
      companyName: 'Big Bet Sports',
      description: 'A sportsbook operator with high withdrawal volume and frequent KYC tickets',
      tone: 'warm',
    },
  },
  {
    label: 'B2B supplier',
    req: {
      recipientName: 'Priya Natarajan',
      companyName: 'Northstar Odds',
      description:
        'A B2B odds feed and trading platform that powers sportsbooks in Europe, with operator tickets about integrations, feed latency, and market settlement',
      tone: 'direct',
    },
  },
  {
    label: 'affiliate',
    req: {
      recipientName: 'Tom Becker',
      companyName: 'BetCompare Media',
      description:
        'An affiliate site comparing sportsbook bonuses, with partner questions about commissions, tracking, and monthly payouts',
      tone: 'warm',
    },
  },
  {
    label: 'vague description',
    req: {
      recipientName: 'Sam Ortiz',
      companyName: 'Lumen Labs',
      description: 'A small company based in Malta',
      tone: 'direct',
    },
  },
];

interface RunReport {
  case: string;
  tone: string;
  helper: string;
  segment: string;
  status: string;
  drafts: number;
  words: number;
  longestSentence: number;
  problems: string;
}

const countWords = (text: string) => text.split(/\s+/).filter(Boolean).length;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { runs: { type: 'string', default: '1' }, show: { type: 'boolean', default: false } },
  });
  const runs = Number.parseInt(values.runs, 10);
  if (!Number.isInteger(runs) || runs < 1 || runs > 10) {
    console.error('--runs has to be a number from 1 to 10');
    return 1;
  }

  const configResult = loadConfig();
  if (!configResult.ok) {
    console.error(configResult.error);
    return 1;
  }
  const { config } = configResult;
  const model = createOpenAIModel({ apiKey: config.openaiApiKey, model: config.openaiModel });

  console.error(`Running ${CASES.length} cases x ${runs} with ${config.openaiModel}...`);

  // Cases run in parallel, runs of the same case run one after another. That
  // keeps it reasonably quick without hammering either API.
  const reports = await Promise.all(
    CASES.map(async ({ label, req }) => {
      const caseReports: RunReport[] = [];
      for (let i = 0; i < runs; i++) {
        const lookup = await fetchCompanyAnalysis(req.companyName);
        const gtm = toGtmContext(lookup.ok ? lookup.analysis : null);
        const result = await generateEmail(req, gtm, model);

        if (values.show) {
          console.log(`\n----- ${label} (run ${i + 1}) -----\n${result.email}`);
        }

        caseReports.push({
          case: label,
          tone: req.tone,
          helper: lookup.ok ? `${gtm.tier} (${lookup.analysis.confidence.toFixed(2)})` : 'failed',
          segment: inferSegment(req.description, gtm),
          status: result.status,
          drafts: result.attempts,
          words: countWords(result.email),
          longestSentence: Math.max(...splitSentences(result.email).map(countWords)),
          problems: result.status === 'needs_review' ? result.violations.map((v) => v.rule).join(', ') : '',
        });
      }
      return caseReports;
    }),
  );

  const flat = reports.flat();
  console.log();
  console.table(flat);

  const firstTry = flat.filter((r) => r.status === 'ok' && r.drafts === 1).length;
  const needsReview = flat.filter((r) => r.status === 'needs_review').length;
  console.log(
    `\n${flat.length} emails: ${firstTry} clean on the first draft, ` +
      `${flat.length - firstTry - needsReview} fixed by repair, ${needsReview} still need review.`,
  );

  return needsReview > 0 ? 2 : 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);
