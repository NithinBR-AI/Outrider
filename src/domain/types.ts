// Core domain types for Outrider
// Source of truth: docs/spec.md §7

export type SourceRef = {
  kind: 'jira-issue' | 'confluence-page';
  id: string;
  url: string;
  title: string;
  updatedAt: string;
};

export type Incident = {
  source: SourceRef;
  status: 'active' | 'monitoring' | 'resolved';
  summary: string;
  reportedCount?: number;
  startedAt?: string;
};

export type Resolution = {
  source: SourceRef;
  resolvedAt: string;
  resolutionText: string;
  matchReason: 'same-requester' | 'same-symptom' | 'both';
};

export type Article = {
  source: SourceRef;
  excerpt: string;
  kind: 'runbook' | 'policy' | 'guide';
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

export type ActorContext = {
  accountId?: string;
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

export type IndexRecord = {
  docKey: string;
  sourceRef: SourceRef;
  text: string;
  vector?: number[];
  indexedAt: string;
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
