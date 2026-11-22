import type { Tone } from './email/prompt.ts';

// Validation for what the user types in, kept separate from the readline code
// so it can be tested without faking a terminal.

// Long enough for a real description, short enough that someone can't paste
// a whole website into the prompt by accident.
export const MAX_DESCRIPTION_LENGTH = 600;
const MAX_NAME_LENGTH = 100;

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Accepts "direct"/"warm" plus the obvious shortcuts, case-insensitive. */
export function parseTone(raw: string): FieldResult<Tone> {
  const value = raw.trim().toLowerCase();
  if (value === 'direct' || value === 'd') return { ok: true, value: 'direct' };
  if (value === 'warm' || value === 'w') return { ok: true, value: 'warm' };
  return { ok: false, error: 'Tone has to be "direct" or "warm".' };
}

function parseText(raw: string, label: string, maxLength: number): FieldResult<string> {
  // collapse runs of whitespace so "Big   Bet Sports" matches the company name
  // check later on
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value) return { ok: false, error: `${label} can't be empty.` };
  if (value.length > maxLength) {
    return { ok: false, error: `${label} is too long (max ${maxLength} characters).` };
  }
  return { ok: true, value };
}

export const parseRecipientName = (raw: string) => parseText(raw, 'Recipient name', MAX_NAME_LENGTH);
export const parseCompanyName = (raw: string) => parseText(raw, 'Company name', MAX_NAME_LENGTH);
export const parseDescription = (raw: string) => parseText(raw, 'Description', MAX_DESCRIPTION_LENGTH);
