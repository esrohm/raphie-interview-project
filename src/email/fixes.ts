// Last-resort cleanup for when the model still breaks a rule after we've asked
// it to fix things. These only cover the rules that can be fixed with a find
// and replace without mangling the sentence. Long sentences and repeated
// openers need an actual rewrite, so those stay with the model.

// a spaced or unspaced em dash between two words becomes a comma
function replaceEmDashes(text: string): string {
  return text.replace(/\s*\u2014\s*/g, ', ');
}

// "Furthermore, we also..." -> "We also...". Matches the same sentence starts
// the checker does (after a closing quote or paren, or behind a bullet),
// otherwise the checker flags something this can't clean up.
function dropBannedOpeners(text: string): string {
  return text.replace(
    /(^|[.!?]["'”’)\]]*\s+|\n)([-•*]\s+)?(?:furthermore|additionally),?\s+(\w)/gim,
    (_match, before: string, bullet: string | undefined, nextChar: string) =>
      `${before}${bullet ?? ''}${nextChar.toUpperCase()}`,
  );
}

function replaceFantastic(text: string): string {
  return text.replace(/\bfantastic/gi, (word) => (word.startsWith('F') ? 'Great' : 'great'));
}

// keeps the first one, turns the rest into periods
function limitExclamations(text: string): string {
  let seen = false;
  return text.replace(/!/g, () => {
    if (seen) return '.';
    seen = true;
    return '!';
  });
}

export function applyMechanicalFixes(email: string): string {
  return [replaceEmDashes, dropBannedOpeners, replaceFantastic, limitExclamations].reduce(
    (text, fix) => fix(text),
    email,
  );
}
