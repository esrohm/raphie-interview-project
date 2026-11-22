// Checks a generated email against Raphie's "don't sound like a bot" rules.
// The prompt states them too, but the model doesn't always listen.

import type { Tone } from './prompt.ts';

const MAX_SENTENCE_WORDS = 30;
const MAX_EXCLAMATIONS = 1;
const BANNED_OPENERS = ['furthermore', 'additionally'];

export type RuleId =
  | 'em_dash'
  | 'banned_opener'
  | 'banned_word'
  | 'too_many_exclamations'
  | 'repeated_opener'
  | 'long_sentence'
  | 'missing_recipient'
  | 'missing_company'
  | 'missing_call_ask'
  | 'warm_opener';

export interface Violation {
  rule: RuleId;
  // plain english, also gets fed back to the model on a retry
  message: string;
}

/**
 * Rough sentence splitter. Line breaks always end a sentence, which keeps the
 * greeting ("Hi Jane,") and sign-off ("Best, Raphie") from getting glued onto
 * the body. It'll trip on stuff like "e.g." but that's rare enough in a short
 * email that I'd rather keep this simple than pull in an NLP library.
 */
export function splitSentences(text: string): string[] {
  return (
    text
      .split(/\n+/)
      // the [...]* lets a sentence end in a closing quote or paren, like
      // `"hello." We...` or `(a lot.) We...`, and still split there
      .flatMap((line) => line.split(/(?<=[.!?]["'”’)\]]*)\s+/))
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function words(sentence: string): string[] {
  return sentence.split(/\s+/).filter(Boolean);
}

// Lowercased, punctuation stripped, and curly apostrophes straightened, so
// "Raphie," and "Raphie" match, and so do "I’m" and "I'm" (the model uses
// curly ones a lot).
function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/[^a-z0-9']/g, '');
}

// First real word of the sentence. Skips list markers like "-" or "•" so a
// bullet that starts with "Additionally" still gets caught.
function firstWord(sentence: string): string {
  return words(sentence).map(normalizeWord).find(Boolean) ?? '';
}

function preview(sentence: string, max = 8): string {
  const w = words(sentence);
  return w.length > max ? `${w.slice(0, max).join(' ')}...` : sentence;
}

export function checkEmail(email: string): Violation[] {
  const violations: Violation[] = [];
  const sentences = splitSentences(email);

  if (email.includes('\u2014')) {
    violations.push({
      rule: 'em_dash',
      message: 'Contains an em dash. Use a comma, period, or colon instead.',
    });
  }

  // catches "Fantastic" and "fantastically" too
  if (/\bfantastic/i.test(email)) {
    violations.push({ rule: 'banned_word', message: 'Uses the word "fantastic".' });
  }

  const exclamations = (email.match(/!/g) ?? []).length;
  if (exclamations > MAX_EXCLAMATIONS) {
    violations.push({
      rule: 'too_many_exclamations',
      message: `Has ${exclamations} exclamation marks, the limit is ${MAX_EXCLAMATIONS}.`,
    });
  }

  let prevOpener = '';
  let prevSentence = '';
  for (const sentence of sentences) {
    const opener = firstWord(sentence);

    if (BANNED_OPENERS.includes(opener)) {
      violations.push({
        rule: 'banned_opener',
        message: `Sentence starts with "${opener}": "${preview(sentence)}"`,
      });
    }

    if (opener && opener === prevOpener) {
      violations.push({
        rule: 'repeated_opener',
        message: `Two sentences in a row start with "${opener}": "${preview(prevSentence)}" / "${preview(sentence)}"`,
      });
    }

    const count = words(sentence).length;
    if (count > MAX_SENTENCE_WORDS) {
      violations.push({
        rule: 'long_sentence',
        message: `Sentence is ${count} words (max ${MAX_SENTENCE_WORDS}): "${preview(sentence)}"`,
      });
    }

    prevOpener = opener;
    prevSentence = sentence;
  }

  return violations;
}

// Case, curly apostrophes and extra spaces shouldn't decide whether a name
// "appears": the model writes Bob’s Bets when the user typed Bob's Bets.
function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ');
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word match, so "Sam" doesn't count as present just because the email
// says "same". Uses unicode letter classes instead of \b, which treats
// accented letters as word breaks and would never match "José,".
function containsPhrase(haystack: string, phrase: string): boolean {
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(normalizeForMatch(phrase))}(?![\\p{L}\\p{N}])`,
    'u',
  );
  return pattern.test(normalizeForMatch(haystack));
}

/**
 * The brief's required content. The model nearly always includes it, but
 * "nearly always" isn't good enough for email that goes to real prospects.
 */
export function checkRequiredContent(
  email: string,
  expected: { firstName: string; companyName: string },
): Violation[] {
  const violations: Violation[] = [];
  if (!containsPhrase(email, expected.firstName)) {
    violations.push({
      rule: 'missing_recipient',
      message: `Doesn't greet the recipient by name ("${expected.firstName}").`,
    });
  }
  if (!containsPhrase(email, expected.companyName)) {
    violations.push({
      rule: 'missing_company',
      message: `Never mentions the company by its full name ("${expected.companyName}").`,
    });
  }
  // The ask has to actually propose meeting, as a question ("open to a short
  // call?") or an offer ("happy to set up a call"). Just having "talk" or
  // "call" somewhere in the body doesn't count. Unlike the value props, the
  // ask is nearly always worded these few ways, so keywords are reliable here.
  const asksToMeet = splitSentences(email).some(
    (s) =>
      /\b(call|chat|meet|meeting|conversation|talk|demo)\b/i.test(s) &&
      (s.endsWith('?') || /\b(happy to|glad to|love to|let's|set up|hop on|jump on|grab|book)\b/i.test(s)),
  );
  if (!asksToMeet) {
    violations.push({
      rule: 'missing_call_ask',
      message: 'Never suggests meeting up or hopping on a short call.',
    });
  }
  return violations;
}

const GREETING = /^(hi|hello|hey|dear)\b[^.!?]*,$/i;

/**
 * Warm emails have to open with a friendly line about them before the pitch,
 * like the brief's warm example. Without this check the model kept going
 * straight to "I'm reaching out from Raphie", and the two tones read the same.
 */
export function checkTone(email: string, tone: Tone): Violation[] {
  if (tone !== 'warm') return [];
  const sentences = splitSentences(email);
  const opener = GREETING.test(sentences[0] ?? '') ? sentences[1] : sentences[0];
  if (opener && /raphie|reaching out/i.test(opener)) {
    return [
      {
        rule: 'warm_opener',
        message: `Warm tone: the first sentence after the greeting should be a short friendly line about them, not about Raphie or why you're writing. Got: "${preview(opener)}"`,
      },
    ];
  }
  return [];
}
