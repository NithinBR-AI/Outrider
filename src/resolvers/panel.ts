// Panel resolver for the jira:issueContext module.
//
// The panel is a read-only view of the latest stored bundle (spec §17). Opening the panel
// never starts a build.
//
// LIMITATION UNTIL STEP 6c: the stored bundle is returned without read-time authorization.
// Spec §16 requires per-viewer filtering before anything is returned; that is step 6c.
// Deploy this to the development environment only.
import Resolver from '@forge/resolver';
import { getBundle, getStatus } from '../adapters/storage';
import { BuildStatus, ContextBundle } from '../domain/types';
import { MAX_DISPLAY_ITEMS_PER_SECTION } from '../domain/score';

export type PanelState =
  | { state: 'no-bundle' }
  | { state: 'queued' | 'building' | 'failed' | 'superseded'; bundle?: ContextBundle }
  | { state: 'complete'; bundle: ContextBundle };

const resolver = new Resolver();

resolver.define('getContext', async (req): Promise<PanelState> => {
  const extension = req.context?.extension as { issue?: { key?: string } } | undefined;
  const ticketKey = extension?.issue?.key;
  if (!ticketKey) return { state: 'no-bundle' };

  const [status, bundle] = await Promise.all([getStatus(ticketKey), getBundle(ticketKey)]);
  return toPanelState(status, bundle ? forDisplay(bundle) : undefined);
});

/**
 * Applies the display limit (§3.2: at most five items per section). The stored bundle keeps up to
 * MAX_BUNDLE_CANDIDATES items; the panel shows the top of each section, already in ranked order.
 */
export function forDisplay(bundle: ContextBundle): ContextBundle {
  const top = <T>(items: T[] | undefined) => (items ?? []).slice(0, MAX_DISPLAY_ITEMS_PER_SECTION);
  return {
    ...bundle,
    incidents: top(bundle.incidents),
    resolutions: top(bundle.resolutions),
    articles: top(bundle.articles),
    services: top(bundle.services),
  };
}

/** Maps the stored build status and bundle to what the panel shows (spec §17.1). Exported for tests. */
export function toPanelState(status: BuildStatus | undefined, bundle: ContextBundle | undefined): PanelState {
  switch (status?.status) {
    case 'queued':
    case 'building':
    case 'superseded':
      // Keep showing the last bundle while a newer one is prepared (spec §17.5).
      return { state: status.status, bundle };
    case 'failed':
    case 'enqueue_failed':
      return { state: 'failed', bundle };
    case 'complete':
      return bundle ? { state: 'complete', bundle } : { state: 'no-bundle' };
    default:
      return bundle ? { state: 'complete', bundle } : { state: 'no-bundle' };
  }
}

export const panelResolver = resolver.getDefinitions();
