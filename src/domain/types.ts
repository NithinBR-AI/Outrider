// Core domain types for Outrider
// Source of truth: docs/spec.md §7
import type { TeamLink } from './teams';
import type { ClusterSignal } from './cluster';

export type SourceRef = {
  kind: 'jira-issue' | 'confluence-page';
  id: string;
  url: string;
  title: string;
  updatedAt: string;
};

// relevance (0..1): how closely the item matches the ticket, for the panel's relevance indicator
// (§17.2) and MCP "relevance information" (§15.2). Today this is the keyword match strength; it becomes
// the semantic similarity once embeddings exist. Ordering uses the full §9 score, not this value alone.

export type Incident = {
  source: SourceRef;
  status: 'active' | 'monitoring' | 'resolved';
  summary: string;
  relevance: number;
  reportedCount?: number;
  startedAt?: string;
};

export type Resolution = {
  source: SourceRef;
  resolvedAt: string;
  resolutionText: string;
  matchReason: 'same-requester' | 'same-symptom' | 'both';
  relevance: number;
};

export type Article = {
  source: SourceRef;
  excerpt: string;
  kind: 'runbook' | 'policy' | 'guide';
  // 0..1 match strength, as for incidents and resolutions (panel relevance indicator, MCP relevance).
  relevance: number;
};

export type ServiceLink = {
  serviceName: string;
  ownerTeam?: string;
  relationship: 'owns' | 'depends-on' | 'affected-by';
  evidence: string;
  resolvedForAccountId: string;
  serviceObjectId?: string;
};

export type Claim = {
  text: string;
  source: SourceRef;
  span: string;
  grounded: boolean;
};

export type GeneratedClaim = {
  claimId: string;
  text: string;
  citedSourceRef: SourceRef | null;
};

export type PersistedSummary = {
  generatedClaims: GeneratedClaim[];
  // Where the claims came from. Always 'llm': generated live (spec §12.6). No canned summary ships (§13.6).
  origin?: 'llm';
  // For 'llm': hash of the exact prompt the claims came from. A rebuild with an identical prompt reuses
  // these claims instead of calling the model again (spec §12.6).
  promptHash?: string;
};

export type ContextBundle = {
  ticketKey: string;
  builtAt: string;
  buildId: string;
  ticketFingerprint: string;

  incidents: Incident[];
  resolutions: Resolution[];
  articles: Article[];
  services: ServiceLink[];

  summary?: PersistedSummary;

  partial: boolean;
  failures: string[];
};

// The current state of a Jira ticket, normalized from the REST API (spec §8.1).
// The consumer always re-fetches this; event payload text is never trusted.
export type Ticket = {
  key: string;
  projectKey: string;
  summary: string;
  description: string;
  requester?: { accountId: string; displayName?: string };
  requestTypeId?: string;
  priority?: string;
  labels: string[];
  serviceIds: string[];
  status: string;
  updatedAt: string;
};

/**
 * A bundle as one viewer receives it (spec §16.4): sources filtered for that viewer and, instead of the
 * stored generated claims, the summary as verified for that viewer at read time (§13.6). The stored
 * ContextBundle is never sent to a viewer.
 */
export type ViewerBundle = Omit<ContextBundle, 'summary'> & {
  summary?: SummaryResponse & { origin?: PersistedSummary['origin'] };
  // Step 11: teams linked to the projects of the related incidents this viewer can see. Looked up at read
  // time as the viewer (Teamwork Graph), never stored in the ContextBundle.
  teams?: TeamLink[];
  // Step 13: emerging-incident signals that include this ticket, filtered for this viewer at read time.
  emergingSignals?: ClusterSignal[];
};

// What started a build or pass. No account ID: nothing read it, and storing one would make Outrider store user
// personal data (Atlassian's user privacy guide for Forge apps). Removed 2026-11-24.
export type ActorContext = {
  source: 'jira-event' | 'confluence-event' | 'unknown';
};

export type BuildJob =
  | {
      kind: 'jira-ticket';
      ticketKey: string;
      buildId: string;
      requestedAt: string;
      actor: ActorContext;
    }
  | {
      kind: 'confluence-page';
      contentId: string;
      operation: 'upsert' | 'delete';
      buildId: string;
      requestedAt: string;
      actor: ActorContext;
    }
  | {
      // Step 13: one clustering pass over a project's open requests (spec §4.3, §14).
      kind: 'cluster-pass';
      projectKey: string;
      buildId: string;
      requestedAt: string;
      actor: ActorContext;
    };

export type BuildStatus = {
  ticketKey: string;
  buildId: string;
  requestedAt: string;
  status:
    | 'queued'
    | 'building'
    | 'complete'
    | 'failed'
    | 'superseded'
    | 'enqueue_failed';
  actor: ActorContext;
  error?: string;
};


export type PendingContext = {
  status: 'pending';
  ticketKey: string;
  buildId: string;
  requestedAt: string;
  message: string;
};

export type RejectedClaim = {
  text: string;
  reason: 'no-matching-span';
};

export type SummaryResponse = {
  claims: Claim[];
  rejected: RejectedClaim[];
};
