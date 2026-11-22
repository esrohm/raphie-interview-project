import { createInterface, type Interface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import OpenAI from 'openai';
import { fetchCompanyAnalysis, type AnalysisResult } from './companyAnalysis/client.ts';
import { toGtmContext, type GtmContext } from './companyAnalysis/confidence.ts';
import { loadConfig } from './config.ts';
import { generateEmail } from './email/generate.ts';
import { createOpenAIModel } from './email/openaiModel.ts';
import type { EmailRequest } from './email/prompt.ts';
import {
  parseCompanyName,
  parseDescription,
  parseRecipientName,
  parseTone,
  type FieldResult,
} from './input.ts';

// Status messages and prompts go to stderr, and only the finished email goes
// to stdout. That way `npm start -s | pbcopy` copies just the email.
const log = (message = '') => process.stderr.write(`${message}\n`);

const USAGE = `Usage: npm start [-- options]

Asks for anything you don't pass as a flag.

  --name         recipient's name, e.g. "Alex Gould"
  --company      company name, e.g. "Big Bet Sports"
  --description  short description of the company
  --tone         direct | warm
  -h, --help     show this message`;

// exit codes, so a script calling this can tell "worked" from "worked but
// someone needs to look at it"
const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_NEEDS_REVIEW = 2;
const EXIT_CANCELLED = 130;

class CancelledError extends Error {}

/**
 * Gets one field, from a flag if it was passed, otherwise by asking until the
 * answer is valid. A bad flag is an error instead of a re-prompt, since flags
 * usually mean a script is driving this and nobody's there to answer.
 */
async function getField<T>(
  ask: (question: string) => Promise<string>,
  question: string,
  parse: (raw: string) => FieldResult<T>,
  flagValue: string | undefined,
): Promise<T> {
  if (flagValue !== undefined) {
    const result = parse(flagValue);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  }

  for (;;) {
    const result = parse(await ask(`${question}: `));
    if (result.ok) return result.value;
    log(`  ${result.error}`);
  }
}

function describeLookup(companyName: string, result: AnalysisResult, gtm: GtmContext): string {
  if (!result.ok) {
    return `Couldn't get company insights (${result.reason}), writing from the description only.`;
  }
  const confidence = result.analysis.confidence.toFixed(2);
  switch (gtm.tier) {
    case 'none':
      return `Not much is known about ${companyName} (confidence ${confidence}), writing from the description only.`;
    case 'medium':
      return `Partial match for ${companyName} (confidence ${confidence}), using the broad strokes as hints.`;
    case 'high': {
      const kind = [gtm.facts.companyType, gtm.facts.vertical].filter(Boolean).join(', ');
      return `Found ${companyName}${kind ? ` (${kind})` : ''}, confidence ${confidence}.`;
    }
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof OpenAI.AuthenticationError) {
    return 'OpenAI rejected the API key. Double check OPENAI_API_KEY in your .env.';
  }
  if (err instanceof OpenAI.RateLimitError) {
    return 'OpenAI rate limit or quota hit. Wait a bit and try again, or check the account billing.';
  }
  if (err instanceof OpenAI.APIConnectionTimeoutError) {
    return 'OpenAI took too long to respond. Try again in a minute.';
  }
  if (err instanceof OpenAI.APIConnectionError) {
    return "Couldn't reach OpenAI. Check your internet connection.";
  }
  if (err instanceof OpenAI.APIError) {
    return `OpenAI returned an error (${err.status ?? 'no status'}): ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

async function main(): Promise<number> {
  const { values: flags } = parseArgs({
    options: {
      name: { type: 'string' },
      company: { type: 'string' },
      description: { type: 'string' },
      tone: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (flags.help) {
    log(USAGE);
    return EXIT_OK;
  }

  const configResult = loadConfig();
  if (!configResult.ok) {
    log(configResult.error);
    return EXIT_ERROR;
  }
  const { config } = configResult;

  // Only open readline if we actually have to ask something. Otherwise it
  // holds stdin open and the process never exits when every flag is passed.
  //
  // Reading through the async iterator instead of rl.question() for two
  // reasons. question() drops lines that arrive before it's called, so piped
  // input loses answers. And when stdin closes (Ctrl+C, Ctrl+D, end of a pipe)
  // a pending question() never settles and the process silently exits 0. The
  // iterator buffers lines and just reports "done" on close.
  let readline: Interface | undefined;
  let lines: AsyncIterator<string> | undefined;
  const ask = async (question: string) => {
    if (!readline || !lines) {
      readline = createInterface({ input: process.stdin, output: process.stderr });
      readline.on('SIGINT', () => readline?.close());
      lines = readline[Symbol.asyncIterator]();
    }
    readline.setPrompt(question);
    readline.prompt();
    const next = await lines.next();
    if (next.done) throw new CancelledError();
    return next.value;
  };

  let req: EmailRequest;
  try {
    req = {
      recipientName: await getField(ask, "Recipient's name", parseRecipientName, flags.name),
      companyName: await getField(ask, 'Company name', parseCompanyName, flags.company),
      description: await getField(ask, 'Short company description', parseDescription, flags.description),
      tone: await getField(ask, 'Tone (direct / warm)', parseTone, flags.tone),
    };
  } finally {
    readline?.close();
  }

  log(`\nLooking up ${req.companyName}...`);
  const lookup = await fetchCompanyAnalysis(req.companyName);
  const gtm = toGtmContext(lookup.ok ? lookup.analysis : null);
  log(describeLookup(req.companyName, lookup, gtm));

  log(`Writing the email with ${config.openaiModel}...`);
  const model = createOpenAIModel({ apiKey: config.openaiApiKey, model: config.openaiModel });
  const result = await generateEmail(req, gtm, model);

  log();
  process.stdout.write(`${result.email}\n`);
  log();

  if (result.status === 'needs_review') {
    log(`Heads up: this draft still breaks ${result.violations.length} rule(s), fix before sending:`);
    for (const v of result.violations) log(`  - ${v.message}`);
    return EXIT_NEEDS_REVIEW;
  }

  log(result.attempts > 1 ? `Passed all checks (took ${result.attempts} drafts).` : 'Passed all checks.');
  return EXIT_OK;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof CancelledError) {
      log('\nCancelled.');
      process.exitCode = EXIT_CANCELLED;
      return;
    }
    if (err instanceof TypeError && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS')) {
      log(`${err.message}\n\n${USAGE}`);
    } else {
      log(`\nError: ${friendlyError(err)}`);
    }
    // the friendly message hides the details, so keep a way to see them
    if (process.env.DEBUG) console.error(err);
    process.exitCode = EXIT_ERROR;
  },
);
