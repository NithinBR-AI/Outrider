// Canned demo summary (spec §13.6, §21 "demo discipline"). Data only.
//
// The demo must not depend on a live LLM response, and must show at least one claim the verifier rejects
// with no-matching-span while citing a source the demo viewer CAN see. This fixture provides that for the
// primary demo ticket. It is marked origin: 'demo-fixture'; the narration and write-up must say so.
// The verifier runs live against it on every read: the fixture fixes the claims, never the outcome.
//
// Sources are the seeded demo-site issues (see outrider-seed/README.md):
//   ITO-9647  active incident "Login service is experiencing intermittent failures"
//   ITO-9642  resolved incident "Login service failure due to expired SSL certificate"
// Expected for a viewer who can see both: 3 grounded claims, 1 rejected, 1 omitted (uncited).
// Expected for a viewer who cannot see ITO: no summary at all.
import { PersistedSummary, SourceRef } from './types';

const SITE = 'https://one-atlas-edlg.atlassian.net';
const cite = (id: string, title: string): SourceRef => ({ kind: 'jira-issue', id, url: `${SITE}/browse/${id}`, title, updatedAt: '' });
const INCIDENT = cite('ITO-9647', 'Login service is experiencing intermittent failures');
const SSL_FIX = cite('ITO-9642', 'Login service failure due to expired SSL certificate');

export const DEMO_SUMMARIES: Record<string, PersistedSummary> = {
  'ITS-6265': {
    origin: 'demo-fixture',
    generatedClaims: [
      {
        claimId: 'demo-1',
        text: 'The auth service is returning 503 errors, affecting roughly 30% of login attempts.',
        citedSourceRef: INCIDENT,
      },
      {
        claimId: 'demo-2',
        text: "A previous login outage was fixed when the team renewed certificate via Let's Encrypt and reloaded nginx.",
        citedSourceRef: SSL_FIX,
      },
      {
        claimId: 'demo-3',
        text: 'Since then, certificate expiry monitoring alerts the team 30 days ahead.',
        citedSourceRef: SSL_FIX,
      },
      {
        // Deliberately unsupported: cites a source the demo viewer can see, but nothing in it says this.
        claimId: 'demo-4-unsupported',
        text: 'The outage started after a database failover in the EU region.',
        citedSourceRef: INCIDENT,
      },
      {
        // No citation: always omitted, never shown or counted.
        claimId: 'demo-5-uncited',
        text: 'Customers using the mobile app are not affected.',
        citedSourceRef: null,
      },
    ],
  },
};

/** The canned summary for a ticket, if it is a demo ticket. */
export function demoSummaryFor(ticketKey: string): PersistedSummary | undefined {
  return DEMO_SUMMARIES[ticketKey];
}
