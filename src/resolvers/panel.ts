// Panel resolver for the jira:issueContext module.
//
// The panel is a read-only view of the latest stored bundle (spec §17). Opening the panel never
// starts a build. Every response is built for the current viewer (spec §16.1, §16.4):
// 1. One visibility check AS THE VIEWER covers the ticket and every source in the stored bundle.
// 2. If the viewer cannot see the ticket, or the check fails, the panel gets a generic "unavailable"
//    state with no bundle, no build status and no hint that context exists.
// 3. Otherwise the bundle is filtered to the sources the viewer can see right now (so a revoked
//    permission takes effect on the next read), then limited for display.
// The stored bundle is never returned as is.
import Resolver from '@forge/resolver';
import { getBundle, getStatus } from '../adapters/storage';
import { visibleIssueKeys } from '../adapters/jira';
import { BuildStatus, ViewerBundle } from '../domain/types';
import { MAX_DISPLAY_ITEMS_PER_SECTION } from '../domain/score';
import { bundleSourceKeys } from '../domain/authorize';
import { viewerBundle } from './viewerContext';
import { getSettings } from '../adapters/settings';
import { isBundleTicket } from '../domain/settings';

export type PanelState =
  | { state: 'no-bundle' }
  | { state: 'unavailable' }
  | { state: 'not-set-up' }
  | { state: 'queued' | 'building' | 'failed' | 'superseded'; bundle?: ViewerBundle }
  | { state: 'complete'; bundle: ViewerBundle };

const resolver = new Resolver();

resolver.define('getContext', async (req): Promise<PanelState> => {
  const extension = req.context?.extension as { issue?: { key?: string } } | undefined;
  const ticketKey = extension?.issue?.key;
  if (!ticketKey) return { state: 'unavailable' };
  return getPanelContext(ticketKey);
});

/** Builds the viewer's panel state for a ticket. Exported for tests. */
export async function getPanelContext(ticketKey: string): Promise<PanelState> {
  const [status, stored, settings] = await Promise.all([getStatus(ticketKey), getBundle(ticketKey), getSettings()]);

  let visible: Set<string> | null;
  try {
    visible = await visibleIssueKeys([ticketKey, ...(stored ? bundleSourceKeys(stored) : [])]);
  } catch (err) {
    console.error(`viewer visibility check failed for ${ticketKey}`, err);
    visible = null;
  }

  // Ticket-level gate (§16.1, security test #2). A failed check counts as no access (§16.5).
  if (visible === null || !visible.has(ticketKey)) return { state: 'unavailable' };

  // Not set up (Phase 5.5): no settings, or this project does not get context. Said plainly, so the panel
  // never waits on "being prepared" for a build that will never run. Checked after the ticket gate.
  if (!isBundleTicket(settings, ticketKey)) return { state: 'not-set-up' };

  const bundle = stored ? forDisplay(await viewerBundle(stored, visible)) : undefined;
  return toPanelState(status, bundle);
}

/**
 * Applies the display limit (§3.2: at most five items per section). The stored bundle keeps up to
 * MAX_BUNDLE_CANDIDATES items; the panel shows the top of each section, already in ranked order.
 */
export function forDisplay(bundle: ViewerBundle): ViewerBundle {
  const top = <T>(items: T[] | undefined) => (items ?? []).slice(0, MAX_DISPLAY_ITEMS_PER_SECTION);
  return {
    ...bundle,
    incidents: top(bundle.incidents),
    resolutions: top(bundle.resolutions),
    articles: top(bundle.articles),
    services: top(bundle.services),
    teams: top(bundle.teams),
  };
}

/** Maps the stored build status and the viewer's bundle to what the panel shows (spec §17.1). Exported for tests. */
export function toPanelState(status: BuildStatus | undefined, bundle: ViewerBundle | undefined): PanelState {
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
