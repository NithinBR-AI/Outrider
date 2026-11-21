// Query helpers for the find-* MCP tools (spec §15.2, §15.3). Pure.
import { describe, expect, it } from 'vitest';
import { cleanQueryText, MAX_QUERY_CHARS, MAX_TOOL_RESULTS, textQuery, withHint } from '../query';
import { MAX_DISPLAY_ITEMS_PER_SECTION } from '../score';
import { Ticket } from '../types';

const ticket: Ticket = { key: 'ITS-1', projectKey: 'ITS', summary: 'Cannot log in', description: 'Generic error', labels: [], serviceIds: ['svc'], status: 'Open', updatedAt: 'u', requester: { accountId: 'a' } };

describe('cleanQueryText', () => {
  it('trims, collapses whitespace and caps length', () => {
    expect(cleanQueryText('  VPN \n\n drops   ')).toBe('VPN drops');
    expect(cleanQueryText('x'.repeat(MAX_QUERY_CHARS + 50))).toHaveLength(MAX_QUERY_CHARS);
  });

  it('treats empty, blank and non-text input as no text', () => {
    for (const v of ['', '   \n ', undefined, null, 42, {}, ['VPN']]) expect(cleanQueryText(v)).toBeUndefined();
  });
});

describe('textQuery', () => {
  it('is a ticket-shaped query with only the text: no key, requester, services or labels', () => {
    const q = textQuery('VPN drops after login');
    expect(q).toMatchObject({ key: '', summary: 'VPN drops after login', description: '', labels: [], serviceIds: [] });
    expect(q.requester).toBeUndefined();
  });
});

describe('withHint', () => {
  it('appends the text to the description, keeping the ticket\'s own fields', () => {
    expect(withHint(ticket, 'started after the SSO change')).toEqual({ ...ticket, description: 'Generic error\nstarted after the SSO change' });
  });

  it('uses the text as the description when the ticket has none, and changes nothing without text', () => {
    expect(withHint({ ...ticket, description: '' }, 'hint').description).toBe('hint');
    expect(withHint(ticket, undefined)).toBe(ticket);
  });
});

describe('limits', () => {
  it('returns no more results per call than the panel shows per section', () => {
    expect(MAX_TOOL_RESULTS).toBe(MAX_DISPLAY_ITEMS_PER_SECTION);
  });
});
