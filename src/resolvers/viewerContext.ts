// Builds a viewer's copy of a stored bundle. Shared by the panel resolver and the MCP tools, so both
// read paths apply exactly the same rules (spec §15.5: thin handlers over shared authorization logic).
import { liveSourceTexts } from '../adapters/jira';
import { citedJiraKeys, filterBundleForViewer, withVerifiedSummary } from '../domain/authorize';
import { ContextBundle, ViewerBundle } from '../domain/types';
import { LiveSource } from '../domain/verify';

/**
 * Sources filtered by `visible` (the issue keys the viewer can see, or null if that check failed), and the
 * stored summary verified against the cited sources' live text, fetched AS THE VIEWER (§13.2 step 3).
 * The live fetch also decides which cited sources the viewer may see: anything not returned is omitted.
 */
export async function viewerBundle(stored: ContextBundle, visible: Set<string> | null): Promise<ViewerBundle> {
  const filtered = filterBundleForViewer(stored, visible);
  const keys = citedJiraKeys(stored.summary);
  if (keys.length === 0) return withVerifiedSummary(filtered, stored.summary, new Map());
  let live: Map<string, LiveSource> | null;
  try {
    live = await liveSourceTexts(keys);
  } catch (err) {
    console.error(`live source fetch for verification failed for ${stored.ticketKey}`, err);
    live = null;
  }
  return withVerifiedSummary(filtered, stored.summary, live);
}
