import type { GtmContext } from '../companyAnalysis/confidence.ts';
import { applyMechanicalFixes } from './fixes.ts';
import { buildPrompt, firstName, type EmailRequest, type Prompt } from './prompt.ts';
import { checkEmail, checkRequiredContent, type Violation } from './rules.ts';

// Anything that can turn a prompt into text. The OpenAI version lives in
// openaiModel.ts. Keeping it this small means tests can swap in a fake.
export interface TextModel {
  complete(prompt: Prompt): Promise<string>;
}

export type GenerateResult =
  | { status: 'ok'; email: string; attempts: number }
  // We still hand back the best draft we got so the user can fix it by hand,
  // but the CLI should make it obvious this one isn't ready to send.
  | { status: 'needs_review'; email: string; violations: Violation[]; attempts: number };

// Two rounds of "please fix these" is usually enough. Past that the model
// tends to just shuffle the problem around, and each call adds a few seconds.
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
  gtm: GtmContext,
  model: TextModel,
): Promise<GenerateResult> {
  const prompt = buildPrompt(req, gtm);
  const expected = { firstName: firstName(req.recipientName), companyName: req.companyName };
  const findViolations = (email: string) => [...checkEmail(email), ...checkRequiredContent(email, expected)];

  let email = cleanModelOutput(await model.complete(prompt));
  let violations = findViolations(email);
  let attempts = 1;

  while (violations.length > 0 && attempts <= MAX_REPAIRS) {
    email = cleanModelOutput(await model.complete(repairPrompt(prompt, email, violations)));
    violations = findViolations(email);
    attempts++;
  }

  if (violations.length > 0) {
    email = applyMechanicalFixes(email);
    violations = findViolations(email);
  }

  return violations.length === 0
    ? { status: 'ok', email, attempts }
    : { status: 'needs_review', email, violations, attempts };
}
