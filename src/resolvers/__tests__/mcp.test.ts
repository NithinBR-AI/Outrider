// Unit tests for the get-ticket-context action handler: caller identity and ticket key resolution.
// The tool logic is mocked. Integration coverage: tests/integration/mcp-authorization.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tool = vi.hoisted(() => vi.fn());
const find = vi.hoisted(() => ({ incidents: vi.fn(), resolutions: vi.fn() }));
vi.mock('../../mcp/tools', () => ({ getTicketContext: tool, findRelatedIncidents: find.incidents, findSimilarResolutions: find.resolutions }));

import { findRelatedIncidents, findSimilarResolutions, getTicketContext, resolveFindQuery, resolveTicketKey } from '../mcp';
import { MAX_QUERY_CHARS } from '../../domain/query';

beforeEach(() => {
  tool.mockReset().mockResolvedValue({ status: 'pending' });
  find.incidents.mockReset().mockResolvedValue({ incidents: [], partial: false, failures: [] });
  find.resolutions.mockReset().mockResolvedValue({ resolutions: [], partial: false, failures: [] });
});

describe('resolveFindQuery (find-* tool inputs)', () => {
  const page = { context: { jira: { issueKey: 'ITS-6265' } } };

  it('takes a valid ticket key, normalized, with optional free text', () => {
    expect(resolveFindQuery({ ticketKey: ' its-1 ' }, 'keywords')).toEqual({ ticketKey: 'ITS-1', text: undefined });
    expect(resolveFindQuery({ ticketKey: 'ITS-1', keywords: '  VPN  drops ' }, 'keywords')).toEqual({ ticketKey: 'ITS-1', text: 'VPN drops' });
    expect(resolveFindQuery({ ticketKey: 'ITS-1', description: '503 on login' }, 'description')).toEqual({ ticketKey: 'ITS-1', text: '503 on login' });
  });

  it('rejects a malformed ticket key instead of silently searching the text', () => {
    expect(resolveFindQuery({ ticketKey: 'the login ticket', keywords: 'VPN' }, 'keywords')).toMatchObject({ status: 'invalid-request' });
    expect(resolveFindQuery({ ticketKey: 'ITS-1) OR project = X', keywords: 'VPN' }, 'keywords')).toMatchObject({ status: 'invalid-request' });
  });

  it('free text alone does not pull in the issue the user is viewing', () => {
    expect(resolveFindQuery({ keywords: 'VPN', ...page }, 'keywords')).toEqual({ text: 'VPN' });
  });

  it('uses the viewed issue only when no input is given at all', () => {
    expect(resolveFindQuery({ ...page }, 'keywords')).toEqual({ ticketKey: 'ITS-6265' });
    expect(resolveFindQuery({ keywords: '   ', ...page }, 'keywords')).toEqual({ ticketKey: 'ITS-6265' });
  });

  it('reads only its own text field, and caps it', () => {
    expect(resolveFindQuery({ description: 'VPN' }, 'keywords')).toMatchObject({ status: 'invalid-request' });
    expect((resolveFindQuery({ keywords: 'x'.repeat(MAX_QUERY_CHARS + 10) }, 'keywords') as { text: string }).text).toHaveLength(MAX_QUERY_CHARS);
  });

  it('asks for a key or text when there is neither', () => {
    expect(resolveFindQuery({}, 'keywords')).toEqual({ status: 'invalid-request', message: 'Provide a Jira issue key such as ITS-123, or keywords.' });
    expect(resolveFindQuery({}, 'description')).toEqual({ status: 'invalid-request', message: 'Provide a Jira issue key such as ITS-123, or description.' });
  });
});

describe('find-* handlers', () => {
  const caller = { principal: { accountId: 'user-a' } };

  it('refuse without a signed-in caller and never call the tool', async () => {
    for (const ctx of [undefined, {}, { principal: {} }, { principal: { accountId: '' } }]) {
      expect(await findRelatedIncidents({ keywords: 'VPN' }, ctx)).toEqual({ status: 'invalid-request', message: 'This tool needs a signed-in user.' });
      expect(await findSimilarResolutions({ description: 'VPN' }, ctx)).toMatchObject({ status: 'invalid-request' });
    }
    expect(find.incidents).not.toHaveBeenCalled();
    expect(find.resolutions).not.toHaveBeenCalled();
  });

  it('pass the resolved query to the tool', async () => {
    await findRelatedIncidents({ ticketKey: 'its-1', keywords: 'VPN' }, caller);
    expect(find.incidents).toHaveBeenCalledWith({ ticketKey: 'ITS-1', text: 'VPN' });
    await findSimilarResolutions({ description: '503 errors' }, caller);
    expect(find.resolutions).toHaveBeenCalledWith({ text: '503 errors' });
  });

  it('return invalid-request without calling the tool when the input is unusable', async () => {
    expect(await findRelatedIncidents({}, caller)).toMatchObject({ status: 'invalid-request' });
    expect(await findSimilarResolutions(undefined as unknown as Record<string, unknown>, caller)).toMatchObject({ status: 'invalid-request' });
    expect(find.incidents).not.toHaveBeenCalled();
    expect(find.resolutions).not.toHaveBeenCalled();
  });
});

describe('resolveTicketKey', () => {
  it('uses a valid input key', () => {
    expect(resolveTicketKey({ ticketKey: 'ITS-6265' })).toBe('ITS-6265');
  });

  it('normalizes case and surrounding spaces', () => {
    expect(resolveTicketKey({ ticketKey: '  its-6265 ' })).toBe('ITS-6265');
  });

  it('prefers the input over the page context', () => {
    expect(resolveTicketKey({ ticketKey: 'ITS-1', context: { jira: { issueKey: 'ITS-2' } } })).toBe('ITS-1');
  });

  it('falls back to the page context when the input key is invalid', () => {
    expect(resolveTicketKey({ ticketKey: 'the login ticket', context: { jira: { issueKey: 'ITS-6265' } } })).toBe('ITS-6265');
  });

  it('falls back to the page context when the input key is missing', () => {
    expect(resolveTicketKey({ context: { jira: { issueKey: 'its-6265' } } })).toBe('ITS-6265');
  });

  it('returns undefined when both are absent', () => {
    expect(resolveTicketKey({})).toBeUndefined();
    expect(resolveTicketKey({ context: {} })).toBeUndefined();
  });

  it('returns undefined when both are invalid or not strings', () => {
    expect(resolveTicketKey({ ticketKey: 'ITS-', context: { jira: { issueKey: 'not-a-key' } } })).toBeUndefined();
    expect(resolveTicketKey({ ticketKey: 6265, context: { jira: { issueKey: 1 } } })).toBeUndefined();
  });

  it('rejects anything that could change a JQL query', () => {
    expect(resolveTicketKey({ ticketKey: 'ITS-1) OR project = ITO' })).toBeUndefined();
    expect(resolveTicketKey({ ticketKey: 'ITS-1"' })).toBeUndefined();
  });
});

describe('getTicketContext handler', () => {
  it('passes the resolved key and the caller from context.principal to the tool', async () => {
    await getTicketContext({ ticketKey: 'its-6265' }, { principal: { accountId: 'acc-1' } });
    expect(tool).toHaveBeenCalledWith('ITS-6265', 'acc-1');
  });

  it('returns the tool result unchanged', async () => {
    tool.mockResolvedValue({ status: 'not-accessible', ticketKey: 'ITS-1', message: 'm' });
    expect(await getTicketContext({ ticketKey: 'ITS-1' }, { principal: { accountId: 'acc-1' } })).toEqual({ status: 'not-accessible', ticketKey: 'ITS-1', message: 'm' });
  });

  it.each([
    ['no context', undefined],
    ['no principal', { installContext: 'x' }],
    ['empty account ID', { principal: { accountId: '' } }],
    ['non-string account ID', { principal: { accountId: 42 } }],
  ])('no caller (%s): invalid-request, tool never called', async (_name, context) => {
    expect(await getTicketContext({ ticketKey: 'ITS-1' }, context as Record<string, unknown> | undefined)).toMatchObject({ status: 'invalid-request' });
    expect(tool).not.toHaveBeenCalled();
  });

  it('ignores an account ID in the inputs', async () => {
    expect(await getTicketContext({ ticketKey: 'ITS-1', accountId: 'forged' }, undefined)).toMatchObject({ status: 'invalid-request' });
    await getTicketContext({ ticketKey: 'ITS-1', accountId: 'forged' }, { principal: { accountId: 'real' } });
    expect(tool).toHaveBeenCalledWith('ITS-1', 'real');
  });

  it('invalid ticket key: invalid-request, tool never called', async () => {
    expect(await getTicketContext({ ticketKey: 'nope' }, { principal: { accountId: 'acc-1' } })).toMatchObject({ status: 'invalid-request' });
    expect(tool).not.toHaveBeenCalled();
  });

  it('tolerates a missing payload', async () => {
    expect(await getTicketContext(undefined as unknown as Record<string, unknown>, { principal: { accountId: 'acc-1' } })).toMatchObject({ status: 'invalid-request' });
  });
});
