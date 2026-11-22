// Jina adapter tests (step 12). No network: @forge/api fetch is mocked (§19.7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as { url: string; init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } }[],
  respond: undefined as undefined | ((body: { task: string; input: string[] }) => Promise<unknown>),
}));

vi.mock('@forge/api', () => ({
  fetch: async (url: string, init: never) => {
    h.calls.push({ url, init });
    if (!h.respond) throw new Error('unexpected fetch');
    return h.respond(JSON.parse((init as { body: string }).body));
  },
}));

import { EMBEDDING_DIMENSIONS, EMBEDDING_TIMEOUT_MS, embedTicketAndCandidates, JINA_BASE_URL, JINA_MODEL, MAX_EMBEDDING_INPUTS } from '../jina';

const KEY = 'jina-test-key-1234567890';
const vec = (x: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, (_v, i) => (i === 0 ? x : 0));
// A well-formed answer: one vector per input, returned in reverse order to check placement by index.
const ok = (tokens = 10) => async (b: { input: string[] }) => ({
  ok: true,
  status: 200,
  json: async () => ({ data: b.input.map((_t, i) => ({ index: i, embedding: vec(i + 1) })).reverse(), usage: { total_tokens: tokens } }),
});
const body = (i: number) => JSON.parse(h.calls[i].init.body!);

beforeEach(() => {
  h.calls = [];
  h.respond = undefined;
  process.env.JINA_API_KEY = KEY;
});
afterEach(() => {
  delete process.env.JINA_API_KEY;
});

describe('embedTicketAndCandidates', () => {
  it('sends the ticket as a query and the candidates as passages, in two requests, with the agreed model and size', async () => {
    h.respond = ok(7);
    const out = await embedTicketAndCandidates('VPN down', ['VPN runbook', 'Auth runbook']);
    expect(h.calls.map((c) => c.url)).toEqual([`${JINA_BASE_URL}/embeddings`, `${JINA_BASE_URL}/embeddings`]);
    expect(h.calls[0].init.method).toBe('POST');
    expect(h.calls[0].init.headers!.Authorization).toBe(`Bearer ${KEY}`);
    expect(h.calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(body(0)).toEqual({ model: JINA_MODEL, task: 'retrieval.query', dimensions: EMBEDDING_DIMENSIONS, normalized: true, embedding_type: 'float', input: ['VPN down'] });
    expect(body(1)).toMatchObject({ model: JINA_MODEL, task: 'retrieval.passage', input: ['VPN runbook', 'Auth runbook'] });
    expect(out.ticket[0]).toBe(1);
    expect(out.candidates.map((v) => v[0])).toEqual([1, 2]); // placed by index, not response order
    expect(out.tokens).toBe(14);
  });

  it('uses jina-embeddings-v5-text-small at 1024 dimensions with an 8 s timeout', () => {
    expect(JINA_MODEL).toBe('jina-embeddings-v5-text-small');
    expect(EMBEDDING_DIMENSIONS).toBe(1024);
    expect(EMBEDDING_TIMEOUT_MS).toBe(8000);
  });

  it('makes no call without a key', async () => {
    delete process.env.JINA_API_KEY;
    await expect(embedTicketAndCandidates('t', ['c'])).rejects.toThrow('embedding-no-key');
    expect(h.calls).toEqual([]);
  });

  it('refuses an empty or oversized batch before calling', async () => {
    h.respond = ok();
    await expect(embedTicketAndCandidates('t', [])).rejects.toThrow('embedding-bad-input');
    await expect(embedTicketAndCandidates('t', new Array(MAX_EMBEDDING_INPUTS + 1).fill('x'))).rejects.toThrow('embedding-bad-input');
  });

  it('turns HTTP errors, timeouts and network failures into short codes that never contain the key', async () => {
    h.respond = async () => ({ ok: false, status: 429, json: async () => ({ detail: `echo ${KEY}` }) });
    const err = await embedTicketAndCandidates('t', ['c']).catch((e: Error) => e);
    expect((err as Error).message).toBe('embedding-http-429');
    expect(String((err as Error).message)).not.toContain(KEY);
    h.respond = async () => {
      throw Object.assign(new Error('t'), { name: 'TimeoutError' });
    };
    await expect(embedTicketAndCandidates('t', ['c'])).rejects.toThrow('embedding-timeout');
    h.respond = async () => {
      throw Object.assign(new Error('t'), { name: 'AbortError' });
    };
    await expect(embedTicketAndCandidates('t', ['c'])).rejects.toThrow('embedding-timeout');
    h.respond = async () => {
      throw new Error('ECONNRESET');
    };
    await expect(embedTicketAndCandidates('t', ['c'])).rejects.toThrow('embedding-network');
  });

  it('rejects malformed output: bad JSON, missing, duplicate or out-of-range vectors, wrong size, non-numbers', async () => {
    const cases: unknown[] = [
      'not json',
      {},
      { data: [] },
      { data: [{ index: 0, embedding: vec(1) }, { index: 0, embedding: vec(1) }] },
      { data: [{ index: 5, embedding: vec(1) }] },
      { data: [{ index: '0', embedding: vec(1) }] },
      { data: [{ index: 0.5, embedding: vec(1) }] },
      { data: [{ index: 0, embedding: [1, 2, 3] }] },
      { data: [{ index: 0, embedding: 'v' }] },
      { data: [{ index: 0, embedding: vec(Number.NaN) }] },
      { data: [null] },
    ];
    for (const c of cases) {
      h.respond = async () => ({ ok: true, status: 200, json: async () => (c === 'not json' ? Promise.reject(new Error('parse')) : c) });
      await expect(embedTicketAndCandidates('t', ['c']), JSON.stringify(c).slice(0, 60)).rejects.toThrow('embedding-invalid-output');
    }
  });

  it('counts zero tokens when the usage field is missing', async () => {
    h.respond = async (b) => ({ ok: true, status: 200, json: async () => ({ data: b.input.map((_t, i) => ({ index: i, embedding: vec(1) })) }) });
    expect((await embedTicketAndCandidates('t', ['c'])).tokens).toBe(0);
  });
});
