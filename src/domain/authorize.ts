// Read-time filtering of a stored bundle for one viewer (spec §16.4). Pure: no Forge imports, no I/O.
//
// The stored bundle is shared and unfiltered. Every response is built from it for the current viewer:
// - Jira sources (incidents, resolutions) are kept only if the viewer can see that issue right now.
//   Access to the parent ticket is not access to its sources (§16.1, security test #10).
// - Sources that are filtered out leave no trace: no placeholder, no count, no "partial" notice. An
//   empty section looks the same as a genuinely empty one (§16.4, §17.2).
// - If the visibility check itself failed, every Jira source is dropped, the response is marked
//   partial and records auth:jira-check-failed. "Could not verify" means "not authorized" (§16.5).
// - Sections without a read-time check yet (Confluence articles: step 10; Teamwork Graph services:
//   step 11) are never served unchecked, so they are dropped here until their checks exist.
// - The stored summary (generated claims) is never copied over. withVerifiedSummary attaches the
//   summary as verified for this viewer instead (§13.6).
import { ContextBundle, PersistedSummary, ViewerBundle } from './types';
import { citedSources, LiveSource, verifyClaims } from './verify';

export const AUTH_JIRA_CHECK_FAILED = 'auth:jira-check-failed';

/** Every Jira issue key the bundle would reveal to a viewer, other than the ticket itself. */
export function bundleSourceKeys(bundle: ContextBundle): string[] {
  const keys = [
    ...(bundle.incidents ?? []).map((i) => i.source),
    ...(bundle.resolutions ?? []).map((r) => r.source),
  ]
    .filter((s) => s.kind === 'jira-issue')
    .map((s) => s.id);
  return [...new Set(keys)];
}

/**
 * Builds the viewer's copy of a bundle. `visible` is the set of issue keys the viewer can see, or
 * null if the check failed. Always returns a new object; the stored bundle is never returned as is.
 */
export function filterBundleForViewer(bundle: ContextBundle, visible: Set<string> | null): ViewerBundle {
  const canSee = (kind: string, id: string) => visible !== null && kind === 'jira-issue' && visible.has(id);
  const failures = [...(bundle.failures ?? [])];
  if (visible === null && bundleSourceKeys(bundle).length > 0) failures.push(AUTH_JIRA_CHECK_FAILED);

  const filtered: ViewerBundle = {
    ticketKey: bundle.ticketKey,
    builtAt: bundle.builtAt,
    buildId: bundle.buildId,
    ticketFingerprint: bundle.ticketFingerprint,
    incidents: (bundle.incidents ?? []).filter((i) => canSee(i.source.kind, i.source.id)),
    resolutions: (bundle.resolutions ?? []).filter((r) => canSee(r.source.kind, r.source.id)),
    articles: [],
    services: [],
    partial: failures.length > 0,
    failures,
  };
  return filtered;
}

/** The Jira issue keys a stored summary cites, for the live-text fetch. Non-Jira citations are left out. */
export function citedJiraKeys(summary: PersistedSummary | undefined): string[] {
  return citedSources(summary?.generatedClaims ?? []).filter((s) => s.kind === 'jira-issue').map((s) => s.id);
}

/**
 * Attaches the summary as verified for this viewer (spec §13.2, §13.3, §13.6). `live` holds the cited
 * sources the viewer may see, with their current text, or null if that fetch failed.
 * - No stored summary: nothing is attached.
 * - Live fetch failed: no claim can be verified, so none is shown; the response is marked partial with
 *   auth:jira-check-failed ("could not verify" means "not shown", §16.5).
 * - Otherwise the claims are verified. If no claim survives, the summary is omitted entirely, including
 *   its rejected list: an empty summary is never shown (§13.3, §17.3).
 */
export function withVerifiedSummary(viewer: ViewerBundle, summary: PersistedSummary | undefined, live: Map<string, LiveSource> | null): ViewerBundle {
  const { summary: _ignored, ...rest } = viewer;
  if (!summary || (summary.generatedClaims ?? []).length === 0) return rest;
  if (live === null) {
    if (citedJiraKeys(summary).length === 0) return rest;
    const failures = rest.failures.includes(AUTH_JIRA_CHECK_FAILED) ? rest.failures : [...rest.failures, AUTH_JIRA_CHECK_FAILED];
    return { ...rest, failures, partial: true };
  }
  const verified = verifyClaims(summary.generatedClaims, live);
  if (verified.claims.length === 0) return rest;
  return { ...rest, summary: { ...verified, origin: summary.origin } };
}