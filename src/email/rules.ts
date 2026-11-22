// Checks a generated email against Raphie's "don't sound like a bot" rules.
// The model gets told about all of these in the prompt too, but it doesn't
// always listen, so we verify the output here and never just trust it.

const MAX_SENTENCE_WORDS = 30;
const MAX_EXCLAMATIONS = 1;
const BANNED_OPENERS = ['furthermore', 'additionally'];

export type RuleId =
  'em_dash' | 'banned_opener' | 'banned_word' | 'too_many_exclamations' | 'repeated_opener' | 'long_sentence';

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
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function words(sentence: string): string[] {
  return sentence.split(/\s+/).filter(Boolean);
}

// Lowercased first word with punctuation stripped, so "Raphie," and "Raphie"
// count as the same opener.
function firstWord(sentence: string): string {
  const first = words(sentence)[0] ?? '';
  return first.toLowerCase().replace(/[^a-z0-9']/g, '');
}

function preview(sentence: string, max = 8): string {
  const w = words(sentence);
  return w.length > max ? `${w.slice(0, max).join(' ')}...` : sentence;
}

/** Returns every rule the email breaks. Empty array means it's good to go. */
export function checkEmail(email: string): Violation[] {
  const violations: Violation[] = [];
  const sentences = splitSentences(email);

  if (email.includes('—')) {
    violations.push({
      rule: 'em_dash',
      message: 'Contains an em dash. Use a comma, period, or colon instead.',
    });
  }

  // \b so we catch "Fantastic" and "fantastically" but not some unrelated word
  // that just happens to contain it (there aren't many, but still)
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
        message: `Sentence starts with "${words(sentence)[0]}": "${preview(sentence)}"`,
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
