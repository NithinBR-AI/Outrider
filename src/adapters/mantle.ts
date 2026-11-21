// Amazon Bedrock via Mantle (spec §12.6): one chat-completions call with a forced tool call, from the
// build job only. Never on the panel or MCP read path.
//
// - The key is the Forge encrypted variable MANTLE_API_KEY. It is sent only in the Authorization header
//   and never appears in errors, logs or return values.
// - Errors are short codes (generation-*). The caller stores no summary on any failure (§13.3).
// - Fallback: a provider error (timeout, network failure, HTTP 429 or 5xx) on the primary model retries
//   once on FALLBACK_MODEL. Other failures (missing key, HTTP 4xx, invalid output) do not.
import { fetch } from '@forge/api';
import { CLAIMS_SCHEMA, CLAIMS_TOOL_NAME, GenerationPrompt, parseGeneratedClaims } from '../domain/generate';
import { GeneratedClaim } from '../domain/types';

// Must match permissions.external.fetch.backend in manifest.yml.
export const MANTLE_BASE_URL = 'https://bedrock-mantle.us-east-1.api.aws/v1';
export const PRIMARY_MODEL = 'qwen.qwen3-235b-a22b-2507';
export const FALLBACK_MODEL = 'deepseek.v3.2';
// Local test: 2-5 s per call. The build job allows 600 s, so this leaves room for the fallback.
export const REQUEST_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_TOKENS = 1200;

export type GenerationResult = { claims: GeneratedClaim[]; model: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };

const isProviderError = (code: string) => code === 'generation-timeout' || code === 'generation-network' || code === 'generation-http-429' || /^generation-http-5\d\d$/.test(code);

async function callModel(model: string, prompt: GenerationPrompt, key: string): Promise<GenerationResult> {
  let res;
  try {
    res = await fetch(`${MANTLE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
        tools: [{ type: 'function', function: { name: CLAIMS_TOOL_NAME, description: 'Submit the summary claims.', parameters: CLAIMS_SCHEMA } }],
        tool_choice: { type: 'function', function: { name: CLAIMS_TOOL_NAME } },
      }),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    throw new Error(name === 'TimeoutError' || name === 'AbortError' ? 'generation-timeout' : 'generation-network');
  }
  if (!res.ok) throw new Error(`generation-http-${res.status}`);

  let data: { choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: unknown } }[] } }[]; usage?: GenerationResult['usage'] };
  try {
    data = await res.json();
  } catch {
    throw new Error('generation-invalid-output');
  }
  const call = data?.choices?.[0]?.message?.tool_calls?.find((t) => t?.function?.name === CLAIMS_TOOL_NAME);
  if (!call) throw new Error('generation-invalid-output');
  return { claims: parseGeneratedClaims(call.function?.arguments, prompt.labels), model, usage: data.usage };
}

/**
 * Generates claims for one prompt. Throws a short generation-* code on failure; the caller then stores
 * no summary and keeps the source sections (§13.3).
 */
export async function generateClaims(prompt: GenerationPrompt): Promise<GenerationResult> {
  const key = process.env.MANTLE_API_KEY;
  if (!key) throw new Error('generation-no-key');
  try {
    return await callModel(PRIMARY_MODEL, prompt, key);
  } catch (err) {
    const code = (err as Error).message;
    if (!isProviderError(code)) throw err;
    console.warn(`generation: ${PRIMARY_MODEL} failed (${code}), retrying on ${FALLBACK_MODEL}`);
    return callModel(FALLBACK_MODEL, prompt, key);
  }
}
