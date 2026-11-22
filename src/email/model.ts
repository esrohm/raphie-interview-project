import OpenAI from 'openai';

export interface Prompt {
  // stable stuff: who we are, the rules, tone, style references
  instructions: string;
  // per-email stuff: recipient, company, and what we know about them
  input: string;
}

export interface JsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

// Kept this small so tests can swap in a fake.
export interface TextModel {
  complete(prompt: Prompt): Promise<string>;
  // Output still needs validating by the caller, it's LLM output.
  completeJson(prompt: Prompt, schema: JsonSchema): Promise<unknown>;
}

// A single call should take a few seconds, so 30s means something is wrong.
const TIMEOUT_MS = 30_000;

export function createOpenAIModel(options: { apiKey: string; model: string }): TextModel {
  // the SDK already retries 429s, 5xx, and connection errors with backoff
  const client = new OpenAI({ apiKey: options.apiKey, timeout: TIMEOUT_MS, maxRetries: 2 });

  const run = async (prompt: Prompt, text?: OpenAI.Responses.ResponseTextConfig) => {
    const response = await client.responses.create({ model: options.model, ...prompt, text });
    if (!response.output_text.trim()) {
      throw new Error(`OpenAI returned an empty response (status: ${response.status ?? 'unknown'})`);
    }
    return response.output_text;
  };

  return {
    complete: (prompt) => run(prompt),
    async completeJson(prompt, { name, schema }) {
      const text = await run(prompt, { format: { type: 'json_schema', name, schema, strict: true } });
      return JSON.parse(text) as unknown;
    },
  };
}
