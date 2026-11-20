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

import { toPanelState } from '../panel';

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
