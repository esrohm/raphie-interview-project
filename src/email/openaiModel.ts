import OpenAI from 'openai';
import type { TextModel } from './generate.ts';

// A full draft plus a couple of repair rounds should take well under this.
// If a single call sits for 30s something is wrong and we'd rather fail.
const TIMEOUT_MS = 30_000;

export function createOpenAIModel(options: { apiKey: string; model: string }): TextModel {
  // the SDK already retries 429s, 5xx, and connection errors with backoff,
  // so there's no reason to wrap it in a second retry loop
  const client = new OpenAI({ apiKey: options.apiKey, timeout: TIMEOUT_MS, maxRetries: 2 });

  return {
    async complete({ instructions, input }) {
      const response = await client.responses.create({ model: options.model, instructions, input });
      const text = response.output_text;
      if (!text.trim()) {
        throw new Error(`OpenAI returned an empty response (status: ${response.status ?? 'unknown'})`);
      }
      return text;
    },
  };
}
