// Client for the go-to-market helper endpoint. It's slow sometimes (I saw
// 4 to 12 seconds when poking at it) and throws the occasional 503, so this
// retries the 503s and gives up gracefully on everything else. The email can
// always fall back to just the description, so a failure here should never
// kill the CLI.

const ENDPOINT = 'https://code-challenge-basic-463015353641.us-central1.run.app/company-analysis';

// Per attempt. The slowest real response I saw was ~12.5s, so 20s leaves room
// without letting someone stare at a frozen terminal forever.
const TIMEOUT_MS = 20_000;

// 503s are the "try again in a sec" kind of failure, so those get retried.
// Timeouts don't, since retrying a slow request just means waiting twice.
const RETRY_DELAYS_MS = [500, 1500];

export interface CompanyAnalysis {
  vertical?: string;
  companyType?: string;
  operatingRegions: string[];
  supportMotion?: string;
  isCryptoRelated?: boolean;
  kycAmlIntensity?: string;
  // not in the brief's docs, but the endpoint returns them and they're the most useful
  likelyTicketDrivers: string[];
  complianceThemes: string[];
  confidence: number;
}

export type AnalysisResult = { ok: true; analysis: CompanyAnalysis } | { ok: false; reason: string };

// The endpoint uses these when it doesn't actually know, so treat them the
// same as the field being missing.
const PLACEHOLDERS = new Set(['', 'tbd', 'n/a', 'na', 'unknown', 'none', 'null']);

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return PLACEHOLDERS.has(trimmed.toLowerCase()) ? undefined : trimmed;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(cleanString).filter((v): v is string => v !== undefined);
}

/**
 * Validates the raw JSON. Only confidence is required, since without it we
 * can't tell how much to trust anything else. Everything else is optional and
 * anything malformed just gets dropped instead of failing the whole response.
 */
export function parseAnalysis(raw: unknown): CompanyAnalysis | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;

  const confidence = data.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;

  return {
    vertical: cleanString(data.vertical),
    companyType: cleanString(data.companyType),
    operatingRegions: cleanList(data.operatingRegions),
    supportMotion: cleanString(data.supportMotion),
    isCryptoRelated: typeof data.isCryptoRelated === 'boolean' ? data.isCryptoRelated : undefined,
    kycAmlIntensity: cleanString(data.kycAmlIntensity),
    likelyTicketDrivers: cleanList(data.likelyTicketDrivers),
    complianceThemes: cleanList(data.complianceThemes),
    // clamp it in case the endpoint ever sends something weird like 1.2
    confidence: Math.min(1, Math.max(0, confidence)),
  };
}

export interface FetchOptions {
  // injectable so tests don't hit the network or actually sleep
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function fetchCompanyAnalysis(
  name: string,
  options: FetchOptions = {},
): Promise<AnalysisResult> {
  const { fetchImpl = fetch, sleep = defaultSleep, timeoutMs = TIMEOUT_MS } = options;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      return {
        ok: false,
        reason: timedOut ? `timed out after ${timeoutMs}ms` : `request failed: ${String(err)}`,
      };
    }

    const retryDelay = RETRY_DELAYS_MS[attempt];
    if (res.status === 503 && retryDelay !== undefined) {
      await sleep(retryDelay);
      continue;
    }

    if (!res.ok) {
      return { ok: false, reason: `endpoint returned ${res.status}` };
    }

    const raw = await res.text();
    if (process.env.DEBUG) console.error('[company-analysis] raw response:', raw);

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return { ok: false, reason: 'response was not valid JSON' };
    }

    const analysis = parseAnalysis(body);
    return analysis
      ? { ok: true, analysis }
      : { ok: false, reason: 'response was missing a usable confidence score' };
  }
}
