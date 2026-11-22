// Env config, checked once at startup so a missing key fails before we ask the
// user four questions, not after.

// Cheap, fast, and good enough at short-form writing. Override with
// OPENAI_MODEL if you want to compare models.
export const DEFAULT_MODEL = 'gpt-5.4-mini';

export interface Config {
  openaiApiKey: string;
  openaiModel: string;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; error: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.',
    };
  }

  return {
    ok: true,
    config: {
      openaiApiKey: apiKey,
      // treat an empty OPENAI_MODEL= line in .env the same as not setting it
      openaiModel: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
    },
  };
}
