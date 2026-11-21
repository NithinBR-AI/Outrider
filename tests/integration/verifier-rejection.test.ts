// Mandatory verifier-rejection test (spec §19.6). Release blocker; the acceptance test for the P0
// differentiator. Uses fixed test claims: a recorded Qwen3-235B response for ITS-6265
// (tests/fixtures/mantle-its-6265.json) parsed by the real parseGeneratedClaims, plus one uncited claim
// added here. Checked against the real recorded demo-site text of the cited issues
// (tests/fixtures/jira-demo-site.json), through the real panel and MCP read paths. Only Jira and KVS are
// simulated, as per-viewer permission tables. Nothing here ships in the app (§13.6).
import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextBundle, GeneratedClaim, PersistedSummary, SourceRef, ViewerBundle } from '../../src/domain/types';

// Typed loosely on purpose: raw recorded JSON.
const fixture: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'jira-demo-site.json'), 'utf8'));
const recorded: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'mantle-its-6265.json'), 'utf8'));

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  canSee: new Set<string>(),
  liveText: new Map<string, string>(),
  liveFetches: [] as string[][],
  liveFails: false,
}));

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => structuredClone(h.store.get(key)),
    set: async (key: string, value: unknown) => void h.store.set(key, structuredClone(value)),
    delete: async (key: string) => void h.store.delete(key),
  },
}));
vi.mock('@forge/resolver', () => ({ default: class { define() {} getDefinitions() { return {}; } } }));
vi.mock('@forge/events', () => ({ Queue: class { push = async () => ({ jobId: 'j' }); } }));
vi.mock('../../src/adapters/jira', () => ({
  visibleIssueKeys: async (keys: string[]) => new Set(keys.filter((k) => h.canSee.has(k))),
  // Live text as the viewer: only issues the viewer can see, with their CURRENT text.
  liveSourceTexts: async (keys: string[]) => {
    h.liveFetches.push(keys);
    if (h.liveFails) throw new Error('jira-live-text-503');
    const out = new Map<string, { ref: SourceRef; text: string }>();
    for (const k of keys) {
      if (!h.canSee.has(k) || !h.liveText.has(k)) continue;
      out.set(`jira-issue:${k}`, { ref: { kind: 'jira-issue', id: k, url: `https://one-atlas-edlg.atlassian.net/browse/${k}`, title: `${k} live`, updatedAt: 'now' }, text: h.liveText.get(k)! });
    }
    return out;
  },
}));

import { getPanelContext } from '../../src/resolvers/panel';
import { CLAIMS_NOTE, getTicketContext as mcpGetTicketContext, McpSummary, UNSUPPORTED_CLAIM_NOTE } from '../../src/mcp/tools';
import { parseGeneratedClaims } from '../../src/domain/generate';
import { adfToText } from '../../src/domain/extract';
import { AUTH_JIRA_CHECK_FAILED } from '../../src/domain/authorize';

// Real recorded text of the two cited demo-site issues.
const issueText = (issue: any, comments: string[] = []) => [issue.fields.summary, adfToText(issue.fields.description), ...comments].filter(Boolean).join('\n');
const ITO_9647 = issueText(fixture.incidentSearch.issues.find((i: { key: string }) => i.key === 'ITO-9647'));
const ITO_9642 = issueText(
  fixture.resolutionSearch.issues.find((i: { key: string }) => i.key === 'ITO-9642'),
  fixture.comments['ITO-9642'].comments.map((c: { body: unknown }) => adfToText(c.body)),
);

// The labels the prompt gave the model, mapped back to source references as the builder does.
const refFor = (id: string): SourceRef => ({ kind: 'jira-issue', id, url: `https://one-atlas-edlg.atlassian.net/browse/${id}`, title: id, updatedAt: 'built' });
const labels = Object.fromEntries(Object.entries(recorded.labels as Record<string, string>).map(([label, id]) => [label, refFor(id)]));
const GENERATED = parseGeneratedClaims(recorded.arguments, labels);
// Added for case 6 (§19.6): a claim with no citation. Not part of the recording.
const UNCITED: GeneratedClaim = { claimId: 'test-uncited', text: 'Customers using the mobile app are not affected.', citedSourceRef: null };
const SUMMARY: PersistedSummary = { origin: 'llm', promptHash: 'recorded', generatedClaims: [...GENERATED, UNCITED] };

const claimTo = (id: string) => GENERATED.filter((c) => c.citedSourceRef?.id === id).map((c) => c.text);
// The one claim the recorded run had rejected: a reworded statement of the fix (spec §13.2 step 6a).
const REWORDED = "Certificate was renewed via Let's Encrypt and nginx reloaded to resolve the issue.";

const stored: ContextBundle = {
  ticketKey: 'ITS-6265',
  builtAt: '2026-11-21T12:28:57.975Z',
  buildId: 'b1',
  ticketFingerprint: 'fp',
  incidents: [],
  resolutions: [],
  articles: [],
  services: [],
  partial: false,
  failures: [],
  summary: SUMMARY,
};

const panelSummary = async () => {
  const s = await getPanelContext('ITS-6265');
  return 'bundle' in s && s.bundle ? (s.bundle as ViewerBundle).summary : undefined;
};

beforeEach(() => {
  h.store.clear();
  h.store.set('bundle:ITS-6265', stored);
  h.store.set('status:ITS-6265', { ticketKey: 'ITS-6265', buildId: 'b1', requestedAt: 'r', status: 'complete', actor: { source: 'jira-event' } });
  // The test viewer: can see the ticket and both cited sources (as user A on the demo site).
  h.canSee = new Set(['ITS-6265', 'ITO-9647', 'ITO-9642']);
  h.liveText = new Map([['ITO-9647', ITO_9647], ['ITO-9642', ITO_9642]]);
  h.liveFetches = [];
  h.liveFails = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('verifier rejection (spec §19.6)', () => {
  it('1. the fixed test claims cite sources authorized for the test viewer', () => {
    expect(GENERATED).toHaveLength(6);
    const cited = GENERATED.map((c) => c.citedSourceRef!.id);
    expect(new Set(cited)).toEqual(new Set(['ITO-9647', 'ITO-9642']));
    for (const id of cited) expect(h.canSee.has(id)).toBe(true);
    expect(SUMMARY.origin).toBe('llm');
  });

  it('2-3. the claim with no qualifying coverage is absent from the displayed claims', async () => {
    const s = (await panelSummary())!;
    expect(s.claims.map((c) => c.text)).not.toContain(REWORDED);
    expect(s.claims).toHaveLength(5);
    for (const c of s.claims) {
      expect(c.grounded).toBe(true);
      expect(h.liveText.get(c.source.id)).toContain(c.span); // every shown claim carries a verbatim span
    }
  });

  it('4. the rejected-claim counter reports the correct count', async () => {
    const s = (await panelSummary())!;
    expect(s.rejected).toHaveLength(1);
  });

  it('5. the rejection reason is inspectable and reports no-matching-span', async () => {
    const s = (await panelSummary())!;
    expect(s.rejected).toEqual([{ text: REWORDED, reason: 'no-matching-span' }]);
  });

  it('6. a claim with no citation is omitted entirely, with no effect on the counts', async () => {
    const s = (await panelSummary())!;
    expect(JSON.stringify(s)).not.toContain(UNCITED.text);
    expect(s.claims.length + s.rejected.length).toBe(SUMMARY.generatedClaims.length - 1);
  });

  it('7. a claim whose cited source is not authorized is omitted entirely, with no effect on the counts', async () => {
    // The viewer loses access to the SSL fix (ITO-9642); the incident (ITO-9647) stays visible.
    h.canSee.delete('ITO-9642');
    const s = (await panelSummary())!;
    expect(s.claims.map((c) => c.text)).toEqual(claimTo('ITO-9647'));
    // The rejected claim cited ITO-9642, so it is now omitted too: no text, no rejection, no count.
    expect(s.rejected).toEqual([]);
    const json = JSON.stringify(s);
    for (const text of claimTo('ITO-9642')) expect(json).not.toContain(text);
    expect(json).not.toContain('ITO-9642');
  });

  it('8. matching uses the currently retrieved text, not a cached copy', async () => {
    // ITO-9642 is rewritten after the bundle was built: none of its old wording remains.
    h.liveText.set('ITO-9642', 'Closed as a duplicate. See the post-incident review for details.');
    const s = (await panelSummary())!;
    expect(s.claims.map((c) => c.source.id)).toEqual(['ITO-9647', 'ITO-9647', 'ITO-9647']); // ITO-9642 claims no longer match
    expect(s.rejected.map((r) => r.text)).toEqual(claimTo('ITO-9642'));
    expect(h.liveFetches[h.liveFetches.length - 1]).toEqual(['ITO-9647', 'ITO-9642']); // fetched live on this read
  });
});

describe('verifier on the read path', () => {
  it('uses the live source reference for links', async () => {
    const s = (await panelSummary())!;
    expect(s.claims[0].source).toMatchObject({ url: 'https://one-atlas-edlg.atlassian.net/browse/ITO-9647', title: 'ITO-9647 live' });
  });

  it('a viewer who cannot see any cited source gets no summary at all, not an empty one', async () => {
    h.canSee = new Set(['ITS-6265']); // user B on the demo site
    const s = await getPanelContext('ITS-6265');
    expect(s.state).toBe('complete');
    expect((s as { bundle: ViewerBundle }).bundle.summary).toBeUndefined();
    expect(JSON.stringify(s)).not.toContain('503 errors');
  });

  it('if the live fetch fails, no claim is shown and the response is marked partial', async () => {
    h.liveFails = true;
    const s = (await getPanelContext('ITS-6265')) as { bundle: ViewerBundle };
    expect(s.bundle.summary).toBeUndefined();
    expect(s.bundle.partial).toBe(true);
    expect(s.bundle.failures).toContain(AUTH_JIRA_CHECK_FAILED);
  });

  it('the stored generated claims are never sent to a viewer', async () => {
    const s = await getPanelContext('ITS-6265');
    const json = JSON.stringify(s);
    expect(json).not.toContain('generatedClaims');
    expect(json).not.toContain('citedSourceRef');
    expect(json).not.toContain('promptHash');
    expect(json).not.toContain('test-uncited');
  });

  it('MCP returns the same verified claims and rejections as the panel, annotated for agents', async () => {
    const panel = (await panelSummary())!;
    const mcp = (await mcpGetTicketContext('ITS-6265', 'user-a')) as { summary?: McpSummary };
    expect(mcp.summary!.claims).toEqual(panel.claims);
    expect(mcp.summary!.unsupportedClaims.map((u) => u.text)).toEqual(panel.rejected.map((r) => r.text));
    expect(mcp.summary!.unsupportedClaims).toEqual([{ text: REWORDED, reason: 'no-matching-span', note: UNSUPPORTED_CLAIM_NOTE }]);
    expect(mcp.summary!.claimsNote).toBe(CLAIMS_NOTE);
    expect(mcp.summary!.origin).toBe('llm');
    expect(mcp.summary).not.toHaveProperty('rejected');
  });

  it('MCP tells agents an unsupported claim could not be matched, without saying the source lacks the fact', () => {
    expect(UNSUPPORTED_CLAIM_NOTE).toMatch(/could not be matched/);
    expect(UNSUPPORTED_CLAIM_NOTE).toMatch(/do not present it as a fact/i);
    // The rejected claim here is a reworded true statement, so the note must not claim the source lacks it.
    expect(UNSUPPORTED_CLAIM_NOTE).not.toMatch(/not supported by any source/);
    expect(CLAIMS_NOTE).toMatch(/not proof that the claim is true/);
  });

  it('MCP gives a viewer without access to the cited sources no summary', async () => {
    h.canSee = new Set(['ITS-6265']);
    const mcp = (await mcpGetTicketContext('ITS-6265', 'user-b')) as { summary?: unknown };
    expect(mcp.summary).toBeUndefined();
  });

  it('passes the summary origin through: every summary is generated live', async () => {
    expect((await panelSummary())!.origin).toBe('llm');
  });
});
