import type { Prompt, TextModel } from './model.ts';
import { buildPrompt, firstName, TONE_GUIDES, type CompanyContext, type EmailRequest } from './prompt.ts';
import { checkEmail, checkRequiredContent, checkTone, type Violation } from './rules.ts';

export type GenerateResult =
  | { status: 'ok'; email: string; attempts: number }
  // We still hand back the best draft we got so the user can fix it by hand,
  // but the CLI should make it obvious this one isn't ready to send.
  | { status: 'needs_review'; email: string; violations: Violation[]; attempts: number };

// Two rounds of "please fix these" is usually enough. Past that the model
// tends to shuffle the problem around. There's deliberately no find-and-replace
// fallback after this: swapping an em dash for a comma just makes a comma
// splice, which the prompt itself forbids. A human fixes it instead.
const MAX_REPAIRS = 2;

/**
 * Models sometimes wrap the email in a code fence or add a subject line even
 * when told not to. Strip that so it doesn't end up in the email or confuse
 * the rule checks.
 */
export function cleanModelOutput(text: string): string {
  return text
    .trim()
    .replace(/^```\w*\n?|\n?```$/g, '')
    .replace(/^subject:.*\n+/i, '')
    .trim();
}

/**
 * The prompt asks for the sign-off on one line, but the model splits it
 * ("Warm regards,\nRaphie") maybe one time in five. Not worth a repair round,
 * so just put it back the way every other email looks.
 */
export function normalizeSignOff(email: string, signOff: string): string {
  // keep whatever spacing came before the sign-off, only fix the sign-off itself
  return email.replace(
    /(\n\s*)(?:best|warm regards|regards|thanks|cheers),?\s*\n\s*raphie\.?\s*$/i,
    (_match, before: string) => `${before}${signOff}`,
  );
}

function repairPrompt(original: Prompt, draft: string, violations: Violation[]): Prompt {
  return {
    instructions: original.instructions,
    input: `${original.input}

You already wrote this draft:
"""
${draft}
"""

It breaks these rules:
${violations.map((v) => `- ${v.message}`).join('\n')}

Rewrite it so it fixes those problems. Keep everything else as close to the draft as you can.`,
  };
}

export async function generateEmail(
  req: EmailRequest,
  context: CompanyContext,
  model: TextModel,
): Promise<GenerateResult> {
  const prompt = buildPrompt(req, context);
  const expected = { firstName: firstName(req.recipientName), companyName: req.companyName };
  const findViolations = (email: string) => [
    ...checkEmail(email),
    ...checkRequiredContent(email, expected),
    ...checkTone(email, req.tone),
  ];
  const { signOff } = TONE_GUIDES[req.tone];
  const tidy = (raw: string) => normalizeSignOff(cleanModelOutput(raw), signOff);

  let email = tidy(await model.complete(prompt));
  let violations = findViolations(email);
  let attempts = 1;

  while (violations.length > 0 && attempts <= MAX_REPAIRS) {
    email = tidy(await model.complete(repairPrompt(prompt, email, violations)));
    violations = findViolations(email);
    attempts++;
  }

  return violations.length === 0
    ? { status: 'ok', email, attempts }
    : { status: 'needs_review', email, violations, attempts };
}
