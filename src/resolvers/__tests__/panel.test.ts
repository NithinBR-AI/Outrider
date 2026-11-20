// Panel state mapping tests (spec §17.1).
import { describe, expect, it, vi } from 'vitest';
import { BuildStatus, ContextBundle } from '../../domain/types';

vi.mock('@forge/kvs', () => ({ kvs: { get: async () => undefined, set: async () => undefined } }));
vi.mock('@forge/resolver', () => ({
  default: class {
    define() {}
    getDefinitions() {
      return {};
    }
  },
}));

import { forDisplay, toPanelState } from '../panel';
import { MAX_DISPLAY_ITEMS_PER_SECTION } from '../../domain/score';

const bundle = { ticketKey: 'ITS-1', builtAt: 't' } as ContextBundle;
const status = (s: BuildStatus['status']): BuildStatus => ({ ticketKey: 'ITS-1', buildId: 'b', requestedAt: 'r', status: s, actor: { source: 'jira-event' } });

describe('toPanelState', () => {
  it('shows the empty state when nothing exists', () => {
    expect(toPanelState(undefined, undefined)).toEqual({ state: 'no-bundle' });
  });

  it('shows a complete bundle', () => {
    expect(toPanelState(status('complete'), bundle)).toEqual({ state: 'complete', bundle });
  });

  it('shows the empty state if the status says complete but the bundle is missing', () => {
    expect(toPanelState(status('complete'), undefined)).toEqual({ state: 'no-bundle' });
  });

  it.each(['queued', 'building', 'superseded'] as const)('keeps the last bundle visible while %s', (s) => {
    expect(toPanelState(status(s), bundle)).toEqual({ state: s, bundle });
    expect(toPanelState(status(s), undefined)).toEqual({ state: s, bundle: undefined });
  });

  it.each(['failed', 'enqueue_failed'] as const)('reports %s as failed', (s) => {
    expect(toPanelState(status(s), bundle)).toEqual({ state: 'failed', bundle });
  });

  it('shows a stored bundle even without a status record', () => {
    expect(toPanelState(undefined, bundle)).toEqual({ state: 'complete', bundle });
  });
});

describe('forDisplay (display limit, spec §3.2)', () => {
  const many = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));

  it('shows at most five items per section, keeping the ranked order', () => {
    const stored = { ...bundle, incidents: many('i', 10), resolutions: many('r', 7), articles: many('a', 2), services: [] } as unknown as ContextBundle;
    const shown = forDisplay(stored);
    expect(shown.incidents).toEqual(many('i', MAX_DISPLAY_ITEMS_PER_SECTION));
    expect(shown.resolutions).toEqual(many('r', MAX_DISPLAY_ITEMS_PER_SECTION));
    expect(shown.articles).toEqual(many('a', 2));
    expect(shown.services).toEqual([]);
  });

  it('does not change the stored bundle', () => {
    const stored = { ...bundle, incidents: many('i', 8), resolutions: [], articles: [], services: [] } as unknown as ContextBundle;
    forDisplay(stored);
    expect(stored.incidents).toHaveLength(8);
  });

  it('tolerates bundles written before a section existed', () => {
    const shown = forDisplay({ ...bundle } as ContextBundle);
    expect(shown.incidents).toEqual([]);
    expect(shown.services).toEqual([]);
  });
});
