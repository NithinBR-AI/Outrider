// Unit tests for the get-ticket-context action handler: caller identity and ticket key resolution.
// The tool logic is mocked. Integration coverage: tests/integration/mcp-authorization.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tool = vi.hoisted(() => vi.fn());
vi.mock('../../mcp/tools', () => ({ getTicketContext: tool }));

import { getTicketContext, resolveTicketKey } from '../mcp';

beforeEach(() => {
  tool.mockReset().mockResolvedValue({ status: 'pending' });
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
