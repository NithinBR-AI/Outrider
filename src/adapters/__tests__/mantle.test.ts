// Mantle adapter tests (spec §12.6). No network: @forge/api fetch is mocked (§19.7).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as { url: string; init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal } }[],
  responses: [] as (() => Promise<unknown>)[],
}));

vi.mock('@forge/api', () => ({
  fetch: async (url: string, init: never) => {
    h.calls.push({ url, init });
    const next = h.responses.shift();
    if (!next) throw new Error('unexpected fetch');
    return next();
  },
}));

import { FALLBACK_MODEL, generateClaims, MANTLE_BASE_URL, PRIMARY_MODEL, REQUEST_TIMEOUT_MS } from '../mantle';
import { CLAIMS_TOOL_NAME, GenerationPrompt } from '../../domain/generate';
import { SourceRef } from '../../domain/types';

const KEY = 'test-key-1234567890';
const ref: SourceRef = { kind: 'jira-issue', id: 'ITO-9647', url: 'https://x/browse/ITO-9647', title: 't', updatedAt: 'u' };
const prompt: GenerationPrompt = { system: 'SYSTEM', user: 'USER', labels: { S1: ref } };

const ok = (args: unknown, usage = { prompt_tokens: 700, completion_tokens: 150 }) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { tool_calls: [{ function: { name: CLAIMS_TOOL_NAME, arguments: args } }] } }], usage }),
});
const http = (status: number) => async () => ({ ok: false, status, json: async () => ({ error: `echo ${KEY}` }) });
const throws = (name: string) => async () => {
  const e = new Error('boom');
  e.name = name;
  throw e;
};
const CLAIMS = JSON.stringify({ claims: [{ text: 'The auth service is returning 503 errors.', source: 'S1' }] });

beforeEach(() => {
  h.calls = [];
  h.responses = [];
  process.env.MANTLE_API_KEY = KEY;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.MANTLE_API_KEY;
  vi.restoreAllMocks();
});

describe('generateClaims', () => {
  it('fails fast with generation-no-key and makes no call when the key is not set', async () => {
    delete process.env.MANTLE_API_KEY;
    await expect(generateClaims(prompt)).rejects.toThrow('generation-no-key');
    expect(h.calls).toHaveLength(0);
  });

  it('sends one forced tool call to the primary model at temperature 0, with the key only in the header', async () => {
    h.responses.push(ok(CLAIMS));
    const r = await generateClaims(prompt);
    expect(h.calls).toHaveLength(1);
    const { url, init } = h.calls[0];
    expect(url).toBe(`${MANTLE_BASE_URL}/chat/completions`);
    expect(init.method).toBe('POST');
    expect(init.headers?.Authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(init.body!);
    expect(body).toMatchObject({ model: PRIMARY_MODEL, temperature: 0, tool_choice: { type: 'function', function: { name: CLAIMS_TOOL_NAME } } });
    expect(body.messages).toEqual([{ role: 'system', content: 'SYSTEM' }, { role: 'user', content: 'USER' }]);
    expect(body.tools[0].function.name).toBe(CLAIMS_TOOL_NAME);
    expect(init.body).not.toContain(KEY);
    expect(r.model).toBe(PRIMARY_MODEL);
    expect(r.usage).toEqual({ prompt_tokens: 700, completion_tokens: 150 });
    expect(r.claims).toEqual([expect.objectContaining({ text: 'The auth service is returning 503 errors.', citedSourceRef: ref })]);
  });

  it('accepts tool arguments returned as an object', async () => {
    h.responses.push(ok({ claims: [{ text: 'x y', source: 'S1' }] }));
    expect((await generateClaims(prompt)).claims[0].text).toBe('x y');
  });

  it.each([429, 500, 503])('retries once on the fallback model after HTTP %i', async (status) => {
    h.responses.push(http(status), ok(CLAIMS));
    const r = await generateClaims(prompt);
    expect(h.calls.map((c) => JSON.parse(c.init.body!).model)).toEqual([PRIMARY_MODEL, FALLBACK_MODEL]);
    expect(r.model).toBe(FALLBACK_MODEL);
  });

  it.each([
    ['TimeoutError', 'generation-timeout'],
    ['AbortError', 'generation-timeout'],
    ['TypeError', 'generation-network'],
  ])('maps a %s to %s and retries on the fallback model', async (name, code) => {
    h.responses.push(throws(name), throws(name));
    await expect(generateClaims(prompt)).rejects.toThrow(code);
    expect(h.calls).toHaveLength(2);
  });

  it.each([400, 401, 403])('does not retry after HTTP %i', async (status) => {
    h.responses.push(http(status));
    await expect(generateClaims(prompt)).rejects.toThrow(`generation-http-${status}`);
    expect(h.calls).toHaveLength(1);
  });

  it('reports the fallback failure when both models fail', async () => {
    h.responses.push(http(500), http(502));
    await expect(generateClaims(prompt)).rejects.toThrow('generation-http-502');
  });

  it('treats a response without the claims tool call, or a body that is not JSON, as invalid output, without retrying', async () => {
    h.responses.push(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Here are claims' } }] }) }));
    await expect(generateClaims(prompt)).rejects.toThrow('generation-invalid-output');
    h.responses.push(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }));
    await expect(generateClaims(prompt)).rejects.toThrow('generation-invalid-output');
    h.responses.push(ok('{"claims": "nope"}'));
    await expect(generateClaims(prompt)).rejects.toThrow('generation-invalid-output');
    expect(h.calls).toHaveLength(3);
  });

  it('never puts the key in an error, even when the provider echoes it', async () => {
    h.responses.push(http(400));
    const err = await generateClaims(prompt).catch((e: Error) => e);
    expect((err as Error).message).not.toContain(KEY);
    expect(String((err as Error).stack)).not.toContain(KEY);
  });

  it('uses a request timeout well inside the 600 s build job, leaving room for the fallback', () => {
    expect(REQUEST_TIMEOUT_MS * 2).toBeLessThan(600_000);
  });
});
