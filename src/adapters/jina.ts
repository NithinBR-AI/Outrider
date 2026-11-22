// Jina AI embeddings (step 12, spec §12): two batched calls from the build job only, never on the panel or
// MCP read path, and never for the find tools (they stay on keywords).
//
// Provider checked 2026-11-22 against Jina's own pages: free key without a card (10M tokens, one-time),
// "We never use your API requests, inputs, or outputs to train our embedding, reranker, or any other models",
// and commercial use of the hosted API is covered by its service terms. Jina is part of Elastic since 2025.
//
// - The key is the Forge encrypted variable JINA_API_KEY. It is sent only in the Authorization header and
//   never appears in errors, logs or return values.
// - Errors are short codes (embedding-*). The caller then ranks by keywords (§12.5).
// - Queries and documents use Jina's asymmetric retrieval tasks, so they are two requests, sent in parallel.
import { fetch } from '@forge/api';

// Must match the jina remote in manifest.yml.
export const JINA_BASE_URL = 'https://api.jina.ai/v1';
export const JINA_MODEL = 'jina-embeddings-v5-text-small';
// Full size: at 512 and 256 dimensions the recorded VPN ticket kept the Database runbook above the article
// floor (63% and 68% of the VPN runbook); at 1024 it is 55% and dropped.
export const EMBEDDING_DIMENSIONS = 1024;
// Measured 0.7-1.8 s per request from a laptop. Short, because the keyword ranking is always available.
export const EMBEDDING_TIMEOUT_MS = 8_000;
// Inputs per request. A build sends at most 30 candidates (10 per section).
export const MAX_EMBEDDING_INPUTS = 64;

type Task = 'retrieval.query' | 'retrieval.passage';
type EmbeddingResponse = { data?: { index?: unknown; embedding?: unknown }[]; usage?: { total_tokens?: number } };

async function embed(task: Task, input: string[], key: string): Promise<{ vectors: number[][]; tokens: number }> {
  if (input.length === 0 || input.length > MAX_EMBEDDING_INPUTS) throw new Error('embedding-bad-input');
  let res;
  try {
    res = await fetch(`${JINA_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
      body: JSON.stringify({ model: JINA_MODEL, task, dimensions: EMBEDDING_DIMENSIONS, normalized: true, embedding_type: 'float', input }),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    throw new Error(name === 'TimeoutError' || name === 'AbortError' ? 'embedding-timeout' : 'embedding-network');
  }
  if (!res.ok) throw new Error(`embedding-http-${res.status}`);
  let body: EmbeddingResponse;
  try {
    body = (await res.json()) as EmbeddingResponse;
  } catch {
    throw new Error('embedding-invalid-output');
  }
  // One vector per input, placed by its index, each of the expected size with finite numbers only.
  const vectors: number[][] = new Array(input.length);
  for (const d of Array.isArray(body?.data) ? body.data : []) {
    const i = d?.index;
    const v = d?.embedding;
    if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= input.length || vectors[i]) throw new Error('embedding-invalid-output');
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS || !v.every((x) => typeof x === 'number' && Number.isFinite(x))) throw new Error('embedding-invalid-output');
    vectors[i] = v as number[];
  }
  for (let i = 0; i < input.length; i++) if (!vectors[i]) throw new Error('embedding-invalid-output');
  return { vectors, tokens: typeof body.usage?.total_tokens === 'number' ? body.usage.total_tokens : 0 };
}

/**
 * The ticket's vector and one vector per candidate text, in the same order. Throws a short embedding-*
 * code on any failure; the caller then keeps the keyword ranking.
 */
export async function embedTicketAndCandidates(ticketText: string, candidateTexts: string[]): Promise<{ ticket: number[]; candidates: number[][]; tokens: number }> {
  const key = process.env.JINA_API_KEY;
  if (!key) throw new Error('embedding-no-key');
  const [query, passages] = await Promise.all([embed('retrieval.query', [ticketText], key), embed('retrieval.passage', candidateTexts, key)]);
  return { ticket: query.vectors[0], candidates: passages.vectors, tokens: query.tokens + passages.tokens };
}
