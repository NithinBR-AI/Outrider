**Product:** Outrider
**Tagline:** Sent ahead. Context in place.
**Positioning:** An evidence-gated context engine for service operations.
**Status:** MVP specification, written before implementation and then updated with each step's decisions

> **How to read this document.** It was written before implementation, then updated as each step was built: the "Decisions made during implementation" sections record where reality changed the plan, with measurements. Some parts were not built (for example the Confluence index and request clustering). The [README](../README.md) states what the submission actually does. Personal details were removed for publication.

---

# 1. Product identity

## 1.1 One-liner

Outrider is an evidence-gated context engine for service operations — every support request triggers assembly of a permission-aware, source-grounded context bundle, and emerging problems surface before anyone declares an incident.

## 1.2 Spoken pitch

Support agents burn the first part of every ticket hunting for context that already exists — an open incident, a past fix, a runbook, a service dependency.

Outrider goes ahead. When a ticket lands, it assembles a permission-aware context bundle and grounds every AI-generated claim in a verbatim source span. Claims without evidence are dropped, and the drop is visible. When similar requests start clustering around the same confirmed service and structured entity, it raises an emerging-incident signal with an evidence pack, before anyone declares an incident.

The same bundle is exposed over MCP, so AI agents work from the same source-grounded context.

Outrider. Sent ahead. Context in place.

## 1.3 Product definition

Outrider is an evidence-gated context engine for service operations.

Two acts, one engine:

**Act 1 — Context on arrival (P0).** When a request arrives, Outrider asynchronously assembles ticket-specific context from Jira incidents, past Jira resolutions, Confluence runbooks and Teamwork Graph relationships. It delivers the bundle to the JSM agent through an issue context panel and exposes the same engine via Rovo MCP tools.

**Act 2 — Early warning (P1, conditional).** While the agent works, Outrider watches the wider request queue. When multiple requests share a confirmed service identity and a structured entity within a configurable time window, and the count crosses a threshold, it raises an emerging-incident signal backed by an evidence pack. It recommends investigation. It never declares or creates an incident.

**The product is the context engine. The JSM panel is the first client.** The MCP tools are the second. Any future authorized consumer can request the same curated, permission-filtered, evidence-gated bundle.

Outrider is not a chatbot, standalone summarizer, generic search interface, incident response tool, or automated resolver.

## 1.4 Trust terminology

The system provides **source-grounded context** and **source-matched claims**.

A claim is displayable only when a verbatim source span is present **and** the source is authorized for the current viewer. These are one rule, not two. A claim grounded in a source the viewer cannot see is dropped, not shown redacted.

This proves textual support, not that the claim is universally true, and not that the source semantically entails the entire claim.

Never describe output as factually verified, semantically verified, or universally correct.

Permitted wording: source-grounded context; source-matched claim; claim with a matching source span; matching source evidence.

## 1.5 The product is the context engine

The product is the context engine. The JSM panel is the first client. The MCP tools are the second. Every architecture and scope decision is judged against that principle.

**Clustering is an independent P1 capability, not a dependency of the core product.** The core context engine must remain complete and submittable without clustering.

---

# 2. Hackathon objectives

Target: Codegeist 2026 — Build with context. Ship with confidence.

Primary category:
- Apps for Business Teams.

Bonus targets:
- Best app with Teamwork Graph integration.
- Best app with Atlassian MCP integration.

Mandatory:
- Atlassian Forge application.
- Integration with an Atlassian product/platform capability.
- Installable application.
- Working setup instructions.
- Demo video and submission materials.

Do not compromise the core product to chase additional bonus categories.

---

# 3. Product scope

## 3.1 Core demo scenario

One JSM ticket arrives. Act 1:

1. An active or recent incident relevant to the ticket.
2. A past resolution with similar symptoms or the same requester.
3. A relevant Confluence runbook or knowledge article.
4. At least one Teamwork Graph relationship.

A generated summary displays source-matched claims with expandable spans and a visible rejected-claim counter. At least one claim in the demo is deliberately unsupported and visibly rejected by the verifier (§13.6).

Act 2 (conditional on clustering shipping): five additional requests arrive within the configured window, satisfying the configured detection threshold. They share a confirmed service ID and a structured entity. Outrider raises an emerging-incident signal with an evidence pack. The agent sees it in the panel; an MCP caller receives it via `get-emerging-incidents`.

The panel displays the four context sections plus the emerging signal when present. Every item carries source, freshness and relevance.

The same context bundle is available through MCP.

## 3.2 Four sections

- Active and recent incidents.
- Past resolutions.
- Knowledge articles.
- Affected services.

Maximum five displayed items per section.
Maximum twenty candidate items in the stored bundle.

## 3.3 Required capabilities

Core (P0):

- Jira issue event ingestion.
- Asynchronous queue processing.
- Ticket-specific context assembly.
- Jira incident retrieval.
- Jira resolution retrieval.
- Confluence article retrieval.
- One Teamwork Graph relationship.
- Source references and freshness.
- ContextBundle persistence.
- JSM issue context panel.
- External MCP access with three core tools: `get-ticket-context`, `find-related-incidents`, `find-similar-resolutions`.
- Source-span matching for generated claims with a visible rejected-claim counter.
- Partial results when individual sources fail.
- Read-time authorization with filter-at-retrieval.

Conditional (P1):

- Request clustering with canonical identity (service ID + structured entity).
- Emerging-incident signal with evidence pack and lifecycle (`confirmed | uncertain`).
- Fourth MCP tool: `get-emerging-incidents`.

## 3.4 Out of scope

- Automatic replies.
- Automatic ticket resolution.
- Automatic ticket assignment.
- Automatic incident declaration or creation.
- Custom JSM customer portal.
- Rovo agent creation.
- Multi-project administration UI.
- Analytics dashboard.
- Marketplace listing.
- Internationalization.
- Streaming responses.
- Entailment verification.
- Multiple demo scenarios.
- Broad enterprise knowledge-management features.

```markdown
---

# 4. Architecture

## 4.1 Jira ticket flow

Jira issue event
→ Event handler
→ Forge async queue
→ Queue consumer
→ Ticket context builder
→ Jira / Confluence / Teamwork Graph retrieval
→ Ranking
→ Optional summary and source-span matching
→ ContextBundle storage
→ JSM issue context panel / MCP actions

Summary generation is optional at the pipeline level. The P0 demo must include it, with the verifier and rejected-claim counter (§13.6).

## 4.2 Confluence indexing flow

Confluence page event
→ Confluence event handler
→ Forge async queue
→ Queue consumer
→ Page indexing, lifecycle update or deletion
→ Index storage

## 4.3 Clustering flow (conditional, P1)

Clustering runs on its own scheduled trigger, independent of reindexing:

Scheduled clustering trigger (hourly, conditional)
→ Clustering pass over open requests in configured project(s)
→ Canonical identity resolution (from structured fields only)
→ Threshold evaluation
→ ClusterRecord upsert with idempotency and lifecycle transitions
→ Attach to ContextBundle on next read, permission-filtered per caller

Clustering and reindexing are separate operations with separate handlers and separate schedules. They must not share a handler that mixes their responsibilities. When clustering is excluded from the submission, the clustering scheduled trigger, its handler, and its module are all omitted.

These are separate processing paths.

A Confluence page identifier must never reach Jira ticket retrieval.

## 4.4 Repository structure

```text
outrider/
├── docs/
│ └── spec.md
├── manifest.yml
├── package.json
├── package-lock.json
├── tsconfig.json
├── src/
│ ├── index.ts
│ ├── domain/
│ │ ├── types.ts
│ │ ├── extract.ts
│ │ ├── score.ts
│ │ ├── verify.ts
│ │ ├── cluster.ts # P1, conditional
│ │ └── __tests__/
│ ├── adapters/
│ │ ├── jira.ts
│ │ ├── confluence.ts
│ │ ├── twg.ts
│ │ ├── embeddings.ts
│ │ └── storage.ts # clustering storage helpers are P1, conditional
│ ├── pipeline/
│ │ ├── jobs.ts
│ │ ├── route.ts
│ │ ├── enqueue.ts
│ │ ├── buildTicket.ts
│ │ ├── indexPage.ts
│ │ ├── clusterPass.ts # P1, conditional
│ │ └── reindex.ts
│ ├── mcp/
│ │ └── tools.ts # get-emerging-incidents tool is P1, conditional
│ └── ui/
│ └── panel.tsx # emerging-signal card is P1, conditional
└── tests/
    ├── fixtures/
    └── integration/
```

Modules marked P1, conditional are included only when clustering ships. If clustering is excluded from the submission, cluster.ts, clusterPass.ts, the clustering storage helpers, the get-emerging-incidents MCP tool, and the emerging-signal panel UI are all omitted. No stub modules should remain.

Do not add modules without approval.

---

5. Forge application

5.1 Product compatibility

· Jira: required.
· Confluence: optional.

Jira is the primary product because the JSM issue context panel is the core user experience. Confluence is optional so installations without Confluence can still install the core app.

Multi-app compatibility is a Preview capability. It must remain UNCONFIRMED until verified against the current Forge CLI and documentation.

5.2 Intended Forge modules

· jira:issueContext
· rovo:mcp
· action
· consumer
· trigger
· scheduledTrigger (at least one for reindex; a second for clustering only when clustering ships)
· function

The issue context module uses modern UI Kit rendering with render: native.

Every referenced Forge function must be declared in modules.function and map to a real exported handler.

The queue consumer declares its queue and function.

Each scheduled trigger is a separate module.

Unconfirmed: the actual relationship between rovo:mcp tool declarations and action modules. Verify against the installed Forge schema that defining an action does not automatically make it an MCP tool, and that tools: entries in rovo:mcp correctly reference the action keys.

5.3 Intended manifest shape

This is the intended structure, not a claim that every declaration has passed lint.

```yaml
app:
  id: ari:cloud:ecosystem::app/REPLACE_WITH_APP_ID
  compatibility:
    jira:
      required: true
    confluence:
      required: false

modules:
  jira:issueContext:
    - key: outrider-context-panel
      resource: panel
      resolver:
        function: panelResolver
      render: native
      title: Outrider
      label: Outrider
      description: Outrider prepares relevant context for this ticket.

  rovo:mcp:
    - key: outrider-mcp
      name: Outrider MCP
      tools:
        - get-ticket-context
        - find-related-incidents
        - find-similar-resolutions
        # - get-emerging-incidents # add only if clustering ships

  action:
    - key: get-ticket-context
      name: Get ticket context
      function: getTicketContext
      actionVerb: GET
      description: Retrieve source-grounded context for a JSM ticket.
      inputs:
        ticketKey:
          title: Ticket key
          type: string
          required: true

    - key: find-related-incidents
      name: Find related incidents
      function: findRelatedIncidents
      actionVerb: GET
      description: Find related active and recent incidents.
      inputs:
        ticketKey:
          title: Ticket key
          type: string
          required: false
        keywords:
          title: Keywords
          type: string
          required: false

    - key: find-similar-resolutions
      name: Find similar resolutions
      function: findSimilarResolutions
      actionVerb: GET
      description: Find previously resolved tickets with similar symptoms.
      inputs:
        ticketKey:
          title: Ticket key
          type: string
          required: false
        description:
          title: Description
          type: string
          required: false

    # Add only if clustering ships:
    # - key: get-emerging-incidents
    # name: Get emerging incidents
    # function: getEmergingIncidents
    # actionVerb: GET
    # description: Return confirmed or uncertain emerging-incident signals for a service or project.
    # inputs:
    # projectKey: { title: Project key, type: string, required: false }
    # serviceId: { title: Service ID, type: string, required: false }

  consumer:
    - key: outrider-build-consumer
      queue: outrider-build-queue
      function: buildJob

  trigger:
    - key: jira-issue-events
      function: onJiraIssueEvent
      events:
        - avi:jira:created:issue
        - avi:jira:updated:issue

    - key: confluence-page-events
      function: onConfluencePageEvent
      events:
        - avi:confluence:created:page
        - avi:confluence:updated:page
        - avi:confluence:deleted:page
        - avi:confluence:permissions_updated:page
        - avi:confluence:trashed:page
        - avi:confluence:restored:page
        - avi:confluence:moved:page

  scheduledTrigger:
    - key: reindex
      function: onReindex
      interval: hour

    # Add only if clustering ships:
    # - key: cluster-pass
    # function: onClusterPass
    # interval: hour

  function:
    - key: panelResolver
      handler: index.panelResolver

    - key: getTicketContext
      handler: index.getTicketContext

    - key: findRelatedIncidents
      handler: index.findRelatedIncidents

    - key: findSimilarResolutions
      handler: index.findSimilarResolutions

    # - key: getEmergingIncidents
    # handler: index.getEmergingIncidents # add only if clustering ships

    - key: onJiraIssueEvent
      handler: index.onJiraIssueEvent

    - key: onConfluencePageEvent
      handler: index.onConfluencePageEvent

    - key: buildJob
      handler: index.buildJob
      timeoutSeconds: 600

    - key: onReindex
      handler: index.onReindex
      timeoutSeconds: 600

    # - key: onClusterPass
    # handler: index.onClusterPass
    # timeoutSeconds: 600 # add only if clustering ships

resources:
  - key: panel
    path: src/ui/panel.tsx

permissions:
  scopes:
    - read:jira-work
    - read:confluence-content.summary
    - read:confluence-content.all
    - storage:app
    - read:graph:issue:jira
    - read:graph:project:jira
    - read:graph:page:confluence

  external:
    fetch:
      backend:
        - remote: bedrock-mantle # summary generation (§12.6)
remotes:
  - key: bedrock-mantle
    baseUrl: https://bedrock-mantle.us-east-1.api.aws
    operations:
      - fetch
```

Validate the actual manifest with the installed Forge CLI. Verify runtime declaration, compatibility placement, event identifiers, function declarations, timeout settings, required scopes, resource paths, and queue configuration.

Queue configuration to verify:

· The consumer.queue value outrider-build-queue matches how the queue is created in code.
· The consumer function buildJob is declared in modules.function.
· No additional queue-related manifest keys are invented. Use only documented keys.

MCP/action relationship to verify:

· Each rovo:mcp.tools entry corresponds to an action key.
· Each action.key maps to a function declared in modules.function.
· The installed Forge schema confirms this linkage. Do not assume that an action automatically appears as an MCP tool without a rovo:mcp declaration.

Do not add graph user scopes unless the actual query requires them.

Do not add write:confluence-content unless the CLI rejects the manifest without it for the declared events. Verify before adding.

Do not add get-emerging-incidents, cluster-pass, or onClusterPass unless clustering ships.

5.4 Event identifiers, payloads, and indexing lifecycle

The intended Confluence page event identifiers are:

· avi:confluence:created:page
· avi:confluence:updated:page
· avi:confluence:deleted:page
· avi:confluence:permissions_updated:page
· avi:confluence:trashed:page
· avi:confluence:restored:page
· avi:confluence:moved:page

The permissions event uses permissions_updated, with an underscore.

Confluence page events use event.content.id, not event.page.id.

Confluence actor identity is supplied as event.atlassianId and may be absent for anonymous activity.

Verify Jira event payloads separately.

Ignore self-generated events where appropriate to prevent event loops.

Each event type requires defined indexing behavior. Receiving the event is not sufficient; the handler must act.

Event Required indexing behavior
created:page Fetch page, extract text, generate index record, store source URL and freshness.
updated:page Re-fetch, re-extract, replace index record (delete-and-rewrite for that doc key).
permissions_updated:page Update indexed metadata to reflect the current permission state. Mark the record for read-time re-authorization. Do not serve cached content to users who have lost access.
moved:page Update the source URL and hierarchy metadata on the index record. Text content may remain unchanged.
trashed:page Invalidate or remove the index record. Do not serve trashed content as current.
restored:page Re-evaluate indexing eligibility, re-fetch the page, and re-create the index record.
deleted:page Remove the index record. Do not rely on cascading deletion events; reconciliation must also identify records whose sources no longer exist.

Exact scope requirements for each event type must be verified against the installed CLI and current Forge event catalogue. Do not assume read scopes alone suffice for permission events.

5.5 Event timing

Jira event delivery can take minutes.

Do not promise a bundle within ten seconds of ticket creation.

Acceptance:

· Aim for a normal context build to complete within ten seconds after the consumer starts.
· The panel immediately renders the latest available bundle and a queued/building state.
· The UI must not imply that the latest bundle includes an event that has not yet arrived.

---

6. Queue jobs and routing

6.1 Job types

```ts
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
```

The discriminated union prevents a Confluence page job from reaching Jira retrieval.

6.2 Event handlers

Jira handler

1. Extract issue key from the documented payload.
2. Extract actor identity if available.
3. Generate a unique build ID.
4. Write queued status, keyed by build ID.
5. Push a jira-ticket job.
6. Return quickly.

Confluence handler

1. Extract event.content.id.
2. Determine the job operation from the event type using the mapping below.
3. Extract actor identity if available.
4. Generate a unique job ID.
5. Push a confluence-page job.
6. Return quickly.

Confluence event → job operation mapping

Confluence event Job operation Notes
created:page upsert 
updated:page upsert 
permissions_updated:page upsert Refresh authorization metadata; consumer applies §5.4 lifecycle behavior.
moved:page upsert Refresh URL and hierarchy metadata; content may be unchanged.
restored:page upsert Re-evaluate eligibility; re-fetch and re-create index record.
trashed:page delete Invalidate or remove index record.
deleted:page delete Remove index record.

This mapping only determines the job operation. The consumer must apply the specific lifecycle behavior defined in §5.4 for each event type.

Neither handler performs Jira, Confluence, TWG, embedding or LLM retrieval.

If queue insertion fails after status is written, record enqueue_failed only if the current status record still belongs to this build ID and its state is still queued. Do not overwrite building, complete, or superseded, even when the build ID matches. This is a best-effort read-check-write guard, not an atomic compare-and-set.

6.3 Queue API

The intended @forge/events v2 API shape is:

```ts
import { Queue } from '@forge/events';

const queue = new Queue({
  key: 'outrider-build-queue',
});

await queue.push({
  body: job,
});
```

Verify the installed package's exports and type definitions.

Queue consumers must tolerate duplicate delivery and retries.

Preserve the returned job ID where useful for diagnostics.

6.4 Routing

```ts
export async function handleJob(job: BuildJob) {
  switch (job.kind) {
    case 'jira-ticket':
      return buildTicketBundle(job);

    case 'confluence-page':
      return job.operation === 'delete'
        ? deleteIndexedPage(job)
        : upsertIndexedPage(job);

    default: {
      const exhaustive: never = job;
      return exhaustive;
    }
  }
}
```

Do not weaken type safety at the routing boundary with broad casts.

```
```markdown
---

# 7. Data model

## 7.1 SourceRef

```ts
type SourceRef = {
  kind: 'jira-issue' | 'confluence-page';
  id: string;
  url: string;
  title: string;
  updatedAt: string;
};
```

Use kind:id as the composite lookup key. Jira issue keys and Confluence page IDs occupy different namespaces.

7.2 Domain types

```ts
type Incident = {
  source: SourceRef;
  status: 'active' | 'monitoring' | 'resolved';
  summary: string;
  reportedCount?: number;
  startedAt?: string;
};

type Resolution = {
  source: SourceRef;
  resolvedAt: string;
  resolutionText: string;
  matchReason: 'same-requester' | 'same-symptom' | 'both';
};

type Article = {
  source: SourceRef;
  excerpt: string;
  kind: 'runbook' | 'policy' | 'guide';
};

type ServiceLink = {
  serviceName: string;
  ownerTeam?: string;
  relationship: 'owns' | 'depends-on' | 'affected-by';
  evidence: string;
};

type Claim = {
  text: string;
  source: SourceRef;
  span: string;
  grounded: boolean;
};
```

7.3 ContextBundle

The ContextBundle is the single shared response type for panel and MCP.

```ts
type ContextBundle = {
  ticketKey: string;
  builtAt: string;
  buildId: string;
  ticketFingerprint: string;

  incidents: Incident[];
  resolutions: Resolution[];
  articles: Article[];
  services: ServiceLink[];

  summary?: {
    claims: Claim[];
    rejectedCount: number;
  };

  emergingIncident?: ClusterSignal;   // P1, conditional — present only when clustering ships and a signal is active

  partial: boolean;
  failures: string[];
};
```

Do not create parallel panel and MCP response models.

Do not persist full source text unnecessarily. Keep source text ephemeral during matching and persist only the required matching span and source reference.

7.4 BuildStatus

```ts
type BuildStatus = {
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
```

Preserve the original requestedAt throughout the job lifecycle.

Generate unique build IDs using an appropriate supported UUID mechanism. Do not rely on Date.now() alone.

7.5 ClusterSignal — response type (P1, conditional)

The response type separates always-present lifecycle fields from permission-filtered evidence fields. requestKeys, requestCount and evidence are populated per caller at retrieval time. The persisted ClusterRecord (§7.6) stores the unfiltered set.

```ts
type ClusterSignal = {
  // Always present
  signalId: string;
  projectKey: string;
  state: 'confirmed' | 'uncertain';
  windowStart: string;
  windowEnd: string;
  raisedAt: string;
  lastUpdatedAt: string;
  expiresAt: string;

  // Identity — optional; a signal without identity is `uncertain`
  serviceId?: string;
  serviceName?: string;
  entityKind?: 'asset' | 'component' | 'endpoint';
  entityId?: string;

  // Reason — populated only when state === 'uncertain'
  reason?: string;

  // Permission-filtered per caller at retrieval time
  requestKeys: string[];
  requestCount: number;
  evidence: Array<{
    evidenceId: string;
    ticketKey: string;
    matchedOn: string;   // which structured field matched
  }>;
};
```

7.6 ClusterRecord — persisted form (P1, conditional)

```ts
type ClusterRecord = {
  // Always present
  signalId: string;
  projectKey: string;
  state: 'confirmed' | 'uncertain';
  windowStart: string;
  windowEnd: string;
  raisedAt: string;
  lastUpdatedAt: string;
  expiresAt: string;

  // Identity — optional; absence forces `uncertain`
  serviceId?: string;
  serviceName?: string;
  entityKind?: 'asset' | 'component' | 'endpoint';
  entityId?: string;

  // Reason — populated only when state === 'uncertain'
  reason?: string;

  // Unfiltered evidence — filtered at retrieval time for the caller
  requestKeys: string[];
  evidence: Array<{
    evidenceId: string;
    ticketKey: string;
    matchedOn: string;
  }>;

  // Lifecycle bookkeeping
  signalState: 'raised' | 'updated' | 'resolved' | 'expired';
  dismissedBy?: string;
  dismissedAt?: string;
};
```

---

8. Ticket pipeline and concurrency

8.1 Ticket retrieval

The consumer always fetches the current ticket.

Never trust ticket text in the event payload.

Retrieve fields required for fingerprinting, incident matching, resolution matching, article retrieval, ranking and output generation.

Initial fingerprint fields:

· Summary.
· Description.
· Requester.
· Project.
· Request type.
· Priority.
· Labels.
· Associated service identifiers.
· Status.

Add any other field influencing retrieval, ranking or output.

8.2 Shared fingerprint projection

Use one projection function for both initial and final fingerprint calculation.

```ts
function toFingerprintInput(ticket: Ticket) {
  return {
    summary: ticket.summary,
    description: ticket.description,
    requester: ticket.requester?.accountId,
    projectKey: ticket.projectKey,
    requestTypeId: ticket.requestTypeId,
    priority: ticket.priority,
    labels: [...(ticket.labels ?? [])].sort(),
    serviceIds: [...(ticket.serviceIds ?? [])].sort(),
    status: ticket.status,
  };
}
```

Use deterministic serialization and hashing. Sort every array. Use ?? [] rather than || []. Omit fields that change on every edit without affecting retrieval (for example, updatedAt).

Never fingerprint a projection initially and the raw ticket object at the end.

8.3 Retrieval

Run independent source retrieval concurrently. Every source, including Teamwork Graph, must be failure-isolated.

```ts
const [incidents, resolutions, articles, services] =
  await Promise.all([
    safe(() => jira.searchIncidents(ticket), [], failures, 'jira-incidents'),
    safe(() => jira.searchResolutions(ticket), [], failures, 'jira-resolutions'),
    safe(() => confluence.searchArticles(ticket), [], failures, 'confluence'),
    safe(() => resolveTeamworkGraph(ticket, actor), [], failures, 'teamwork-graph'),
  ]);
```

resolveTeamworkGraph is wrapped in safe() like every other source. An unhandled rejection from any single source must not reject the Promise.all and must not block successful sections.

safe() catches the error, records the failure identifier, and returns the fallback value. Each source records a concise failure identifier. Do not store sensitive exception details in user-visible failures.

The failures array is attached to the bundle. partial: true when failures.length > 0.

8.4 Stale-build protection

Before writing a bundle:

1. Re-fetch the ticket.
2. Recalculate the full fingerprint using the shared projection.
3. Compare with the fingerprint used for the build.
4. If different, do not write the stale bundle.
5. Mark the build superseded.
6. Enqueue a fresh build.

8.5 Best-effort per-ticket serialization

Use a per-ticket lock record:

```text
lock:<ticketKey>
```

The record contains: buildId, acquiredAt, expiresAt.

Rules:

1. A consumer checks for an existing unexpired lock.
2. If a different build owns it, do not run a competing build.
3. Record or defer the job so it can be retried.
4. If the lock is expired, attempt recovery.
5. Release only if the current lock still belongs to the releasing build.
6. Use a sensible expiry and recovery path for crashed consumers.

A KVS read followed by a write is not atomic. This is best-effort serialization, not a guaranteed distributed mutex. Do not claim strict mutual exclusion.

The concurrent-build integration test is the acceptance criterion. If it fails, fix the implementation based on the observed failure.

8.6 Bundle write protection

Before writing a bundle, the consumer:

1. Verifies the per-ticket lock is still held by this build.
2. Re-checks the current status record still belongs to this build.
3. Verifies the fingerprint is still current (§8.4).

These checks are best-effort. They reduce the probability of a stale write but do not guarantee strict mutual exclusion under all concurrent execution races.

The intended behavior is that an older build does not overwrite a newer bundle. This is enforced through the per-ticket lock and the generation checks in combination, not through any atomic compare-and-set that KVS provides.

Do not describe the bundle write as strictly protected unless the implementation is changed to use an appropriate atomic coordination mechanism. The concurrent-build integration test is necessary but not sufficient to prove strict mutual exclusion; passing one test does not prove the absence of every race.

The scheduled reconciliation process (§8.7) repairs the observable consequences of races that slip through, including orphaned lock records, stuck statuses, and stale bundles.

8.7 Queue failures and reconciliation ownership

If status is written but queue insertion fails:

· Mark enqueue_failed.
· Record diagnostic information.
· Allow reconciliation to retry.

The enqueue_failed write follows the same guard as §6.2: write only if the current status record still belongs to this build ID and its state is still queued. Do not overwrite building, complete, or superseded.

Reconciliation ownership: the existing reindex scheduled trigger (onReindex) owns reconciliation. Clustering, when it ships, runs on its own separate scheduled trigger (§4.3) and does not perform reconciliation. The two scheduled handlers do not share responsibilities.

Stale-bundle discovery

Reconciliation inspects bundles by enumerating tickets, not by inspecting only tickets already known to have stuck statuses. A bundle can be complete and still stale — for example, after an older build overwrote a newer one, after a ticket was edited while no event reached the app, or after a source changed without an event.

The selection procedure per reconciliation run:

1. Enumerate tickets from the configured projects. Use the same project enumeration the reindex process already performs. No new discovery mechanism is introduced.
2. Process in bounded batches. Each batch is sized so a single invocation stays within the function timeout (§5.3 sets timeoutSeconds: 600 for onReindex). A batch limit constant (reconciliationBatchSize) governs the maximum tickets inspected per invocation.
3. Compare fingerprints. For each ticket in the batch, calculate the current fingerprint via the shared projection (§8.2) and compare it with the stored bundle's ticketFingerprint. A bundle is treated as stale whenever the fingerprints differ, regardless of the current status value.
4. Enqueue a rebuild when fingerprints differ. The rebuild is enqueued as a normal jira-ticket job and follows the same locking and generation rules as any other build.
5. Persist a checkpoint. Record the last-inspected cursor so the next reconciliation run resumes from where the previous one ended. Do not assume a full project enumeration fits within one invocation. When the cursor reaches the end, wrap to the beginning on the next run.

If a stored bundle has no ticketFingerprint (for example, written by an earlier version of the schema), treat it as stale and enqueue a rebuild.

Orphan, lock and stuck-status checks

In addition to the stale-bundle pass, reconciliation performs three checks per run:

1. Orphaned queued statuses. A ticket whose latest status is queued but which has no corresponding active lock.
2. Expired lock records. Lock records whose expiresAt has passed.
3. Stuck in-flight statuses. A ticket whose latest status is building but which has no corresponding active lock.

Grace period for queued work

A queued status without an active lock does not necessarily mean the job is orphaned. The queue consumer may simply not have started yet. Reconciliation applies a configurable age threshold (reconciliationOrphanAgeSeconds, default 300) before treating a queued status without an active lock as orphaned. The threshold must account for normal queue delivery delays. Reconciliation may enqueue a duplicate job; duplicate delivery must remain safe under the idempotency rules in §8.4.

Reconciliation is a repair mechanism for the visible consequences of concurrency races. It does not retroactively enforce strict mutual exclusion; it corrects observable drift. It does not guarantee that a stale write cannot happen.

---

9. Ranking

Use deterministic ranking with named constants.

Initial formula:

```ts
score =
  0.35 * semanticSimilarity +
  0.25 * relationshipStrength +
  0.20 * statusWeight +
  0.10 * recency +
  0.10 * sourceAuthority;
```

All components normalized to 0..1.

Weights, thresholds and half-lives are named constants at the top of the scoring module.

9.1 Semantic similarity

Cosine similarity is normalized to 0..1 using a single documented mapping applied identically to every candidate.

The canonical normalization:

```ts
function normalizeCosine(cosine: number): number {
  if (!Number.isFinite(cosine)) return 0;
  return Math.max(0, Math.min(1, cosine));
}
```

Math.max(0, cosine) maps negative similarities to 0; Math.min(1, cosine) guards against floating-point values marginally above 1. Every implementation of the scoring module must use this same function. Do not substitute a different mapping (for example, (cosine + 1) / 2) without changing the spec, because it alters the meaning of the semantic weight.

If embeddings are unavailable, or the embedding call fails, semanticSimilarity = 0. Embeddings are a ranking booster, never a dependency.

9.2 Relationship strength

· 1.0 when Teamwork Graph confirms the relevant relationship.
· 0 otherwise.

9.3 Status weight

The status weight expresses the current relevance of an item's state. It is the only score term derived from status.

Incidents: Active 1.0, Monitoring 0.6, Resolved 0.2.

Resolutions: Resolved 0.2 flat.

Articles: Constant 0.2.

Services: Constant 1.0. Service links are relationship evidence, not ordinary candidate documents. Do not let this constant distort unrelated document ranking.

Use per-type ranking where necessary.

9.4 Recency

Exponential decay with a 30-day half-life.

Timestamp source per item type:

· Incidents: startedAt.
· Resolutions: resolvedAt.
· Articles: source.updatedAt.
· Services: excluded from the recency term.

9.5 Source authority

Source authority expresses the trust placed in a source type. It is not determined by current status; status is captured exclusively by §9.3, and recency exclusively by §9.4.

· Runbook: 1.0.
· Policy: 1.0.
· Guide: 0.7.
· Resolved ticket (as a Resolution candidate): 0.5.
· Incident: 0.7 (constant, regardless of status).

The incident authority value is constant on purpose. An active incident already outranks a resolved incident through the status term in §9.3, and a recently started incident outranks an older one through the recency term in §9.4. Making source authority depend on incident status as well would count status twice in the same score.

Define explicit values for any additional item types introduced later. Do not derive source authority from status for any item type without changing the spec.

9.6 Deterministic ordering

Sort by:

1. Score descending.
2. Recency descending.
3. Composite source key ascending.

Ties resolve deterministically. Stable sort.

Maximum five items per panel section and twenty candidate items per bundle. Displayed items and stored candidates are distinct limits and must be enforced separately.

```

```markdown
---

# 10. Confluence indexing

## 10.1 Index record

```ts
type IndexRecord = {
  docKey: string; // kind:id
  sourceRef: SourceRef;
  text: string;
  vector?: number[];
  indexedAt: string;
};
```

Storage key: index:<spaceOrProject>:<docKey>.

vector is optional. When embeddings are unavailable or fail, the record is stored without a vector and continues to participate in ranking with semanticSimilarity = 0 (§9.1).

10.2 Indexing identity

Confluence page indexing is app-scoped.

Use the app identity (asApp()) for the indexing operation, subject to the app's declared scopes and the site's actual permissions.

Do not use the page editor as the indexing identity.

The event actor may be absent, deleted, anonymous or an integration. Indexing must not depend on that actor.

The indexing identity's access does not grant end users access to the indexed content. Serving indexed content is separately authorized against the current user under §16.

10.3 Page upsert

For page create/update/restore/move:

1. Fetch the current page using the app identity.
2. Confirm the app can access it.
3. Extract relevant text.
4. Generate or update the index record.
5. Replace the old record safely (delete-and-rewrite for that doc key).
6. Record the current URL, metadata and freshness.

If the page cannot be fetched or the app cannot access it, record the failure and do not overwrite an existing valid record with an empty one.

10.4 Delete and trash

For deletion or trash: remove or invalidate the corresponding index record.

Do not rely on cascading deletion events. Reconciliation (§10.8) must also identify records whose sources no longer exist by comparing indexed doc keys against the live page set in bounded batches.

10.5 Permission changes

For permission changes: invalidate cached page content or mark it for access re-evaluation. Do not assume the indexing identity's permissions represent a user's permissions. Never expose stale indexed content to a user who no longer has access.

Permission changes do not require re-fetching the page text. They require updating metadata so read-time authorization (§16) correctly refuses the content to users who have lost access. The read-time check remains authoritative regardless of what the index record says.

10.6 Page moves

Refresh the source URL and hierarchy metadata after a move. Text content may remain unchanged. Update the sourceRef.url so links from the panel point to the current location.

10.7 Self-generated events

Prevent indexing loops by detecting self-generated events and avoiding unnecessary reprocessing.

10.8 Scheduled reconciliation

The hourly scheduled trigger (onReindex) owns Confluence reconciliation alongside the ticket reconciliation described in §8.7.

Responsibilities:

· Paginate through the configured Confluence space(s) using checkpoints.
· Compare indexed doc keys against live page keys in bounded batches.
· Remove or invalidate index records whose pages no longer exist or are no longer accessible to the app identity.
· Refresh index records whose indexedAt is older than a configurable threshold (indexMaxAgeSeconds) and whose source has been updated since indexedAt.
· Repair missed events where an event was dropped or never delivered.

Constraints:

· Does not perform Teamwork Graph queries. Scheduled triggers have no user context (§11.3).
· Does not assume a full crawl fits within one invocation. Use the same bounded-batch and checkpoint discipline as ticket reconciliation (§8.7).
· Failed batches are retried on the next run. The previous valid index record remains available if a refresh fails.

---

11. Teamwork Graph

11.1 Purpose

Teamwork Graph resolves one useful relationship for the demo. Examples: ticket → affected service, service → owning team, service → dependency, incident → related service.

One real relationship is sufficient for the MVP. Broader graph coverage is a cut-order item (§22).

11.2 Authentication

Intended API:

```ts
api.asUser(accountId).requestTeamworkGraph(query, variables)
```

Verify the actual API signature, Preview status, required scopes and impersonation requirements against the installed Forge environment.

Teamwork Graph calls run as a user, not as the app. Use the original actor's account ID only if all of the following hold:

· An account ID exists on the job's ActorContext.
· Impersonation is supported and enabled in the environment.
· Required scopes are declared in the manifest.
· The user has access to the requested graph data.

Never silently fall back to asApp() to bypass missing user context.

11.3 Missing identity

If actor identity is missing, for example because the event was anonymous or the principal was undefined:

· Skip the TWG lookup.
· Record twg:no-actor in the bundle's failures.
· Preserve all other context.
· Set partial: true where appropriate.

The scheduled reindex trigger runs without a user context and therefore does not call TWG at all (§10.8).

11.4 Permission failure

If impersonation or graph permissions are unavailable:

· Record the TWG source failure (twg:<reason>).
· Continue building the bundle.
· Do not let TWG block the core product.

The failure identifier must be concise and must not include sensitive exception details.

11.5 Failure isolation

TWG retrieval is failure-isolated like every other source (§8.3). An unhandled TWG error must not reject the ticket build or prevent other sections from rendering.

11.6 Actor-scoped evidence — TWG results are never treated as globally readable

TWG runs as the build actor. Its results therefore reflect that actor's permissions at build time, not the permissions of whoever later reads the bundle, and not even the build actor's own permissions if they have since changed.

TWG-derived data must never be treated as safe to serve to any viewer merely because it lives in the shared ContextBundle.

ServiceLink carries its resolution context

```ts
type ServiceLink = {
  serviceName: string;
  ownerTeam?: string;
  relationship: 'owns' | 'depends-on' | 'affected-by';
  evidence: string;

  // Resolution context
  resolvedForAccountId: string; // the actor whose permissions produced this link at build time
  serviceObjectId?: string; // canonical service object ID for re-authorization
};
```

Read-time re-authorization — no exceptions

At read time (§16), the panel resolver and every MCP tool re-authorize every ServiceLink against the current viewer's permissions. There is no shortcut for the build actor.

1. For each ServiceLink in the stored bundle, perform a TWG lookup as the current viewer.
2. If the lookup confirms the relationship exists and is visible to the current viewer, the link is returned.
3. If the lookup fails, times out, returns no matching relationship, or shows the relationship is not visible to the current viewer, the link is dropped from the response and the response's failures array records twg:viewer-not-authorized.
4. The persisted ServiceLink in the stored bundle is unchanged. Only the response is filtered.

Account-ID equality is not an authorization shortcut. A viewer whose account ID equals resolvedForAccountId is re-authorized exactly like every other viewer. The build actor's permissions may have changed since the bundle was built. Treating "the build actor could see it once" as evidence that "the build actor can see it now" is a permission-boundary violation.

Re-authorization lookups are bounded by execution time. Each bundle may contain at most five ServiceLink entries (§9.6). The budget is expressed in wall-clock time, not only in call count. The resolver:

1. Sets a re-authorization deadline (serviceLinkReauthBudgetMs, default half of the resolver's remaining time budget).
2. Iterates the ServiceLink entries sequentially or with bounded concurrency.
3. Stops iterating when the deadline is reached, regardless of how many links have been processed.
4. Drops every unprocessed link for that viewer with twg:viewer-not-authorized.

Limiting the number of calls alone is insufficient: five calls that each take several seconds can exceed the resolver's budget just as easily as fifty fast calls. The time budget is the governing constraint.

Re-authorization cost is per-viewer per-link. Five links on a panel open means up to five TWG calls. If this cost is unacceptable in a given environment, the alternative is to remove TWG results from the shared bundle and resolve them at read time only. That alternative is a spec change, not an implementation detail.

What is explicitly forbidden

· Serving a ServiceLink to any viewer without a fresh re-authorization at read time, including the build actor.
· Using resolvedForAccountId === currentViewerId as proof of current access.
· Storing a ServiceLink without resolvedForAccountId.
· Falling back to the build actor's permissions when the current viewer's lookup fails.
· Treating "the build actor could see it" as evidence that "any viewer can see it".

Failure identifiers

ServiceLink re-authorization failures are recorded as twg:viewer-not-authorized in the response's failures array. This is a viewer-specific failure, not a build failure. The persisted bundle's failures array is unaffected. The response's partial flag is set to true when at least one link was dropped for the viewer.

---

12. Embeddings

12.1 Role

Embeddings improve retrieval and ranking but are not required for the core product.

If embedding generation fails or the provider is unreachable:

· Set semanticSimilarity = 0 for the affected candidates (§9.1).
· Continue with entity matching, relationship strength and deterministic ranking.
· Do not fail the build.

Embeddings are a ranking booster, never a dependency.

12.2 Provider

Use one external embedding provider. Not yet chosen. If the Mantle endpoint used for summary generation (§12.6) offers an embeddings model to the same key, prefer it: same egress declaration and credential. Otherwise decide at Phase 8. Unverified.

External egress declaration does not provide credentials.

Store provider credentials using Forge secure secret storage. Never place credentials in:

· manifest.yml
· Source files
· Plain-text configuration
· Git history
· Logs
· Error messages returned to the panel or MCP

If the secret is unavailable, treat it as an embedding failure and continue without embeddings.

12.3 Data handling

Secure credential storage is not sufficient on its own. Sending tenant content to an external provider is a data-handling decision, not only a security decision.

The following must hold before embeddings are enabled in any environment:

· The provider and data-processing terms have been reviewed and approved for the environment's tenant.
· Only the minimum content required for embedding is sent (page text, ticket text). No source URLs, account IDs, ticket keys, service names or other identifiers are included in the provider request unless the provider terms explicitly permit it.
· The app's privacy documentation discloses that page and ticket text is sent to an external embedding provider.
· The provider does not retain or train on submitted content beyond the terms the tenant has approved.

If any of these conditions is not satisfied for a given environment, embeddings are disabled in that environment. The core product must work without them.

This is an operational gate, not a code path. Document the approval status per environment alongside the app's deployment notes.

12.4 Refresh

Refresh embeddings when pages are created, updated, moved, restored, deleted or trashed, and during scheduled reconciliation for records whose source has changed since indexedAt.

Use delete-and-rewrite semantics for an individual index record. Do not mutate a vector in place while the record is readable.

12.5 Failure handling

If the provider returns an error, a malformed response, or an unexpected vector dimension:

· Do not store the embedding.
· Keep or create the index record without a vector.
· Record the failure at debug level only; do not surface it in the panel or MCP output.
· Continue processing other records.

12.6 Summary generation provider

Summary generation (§13.6) uses Amazon Bedrock through Mantle, an OpenAI-compatible endpoint: https://bedrock-mantle.us-east-1.api.aws/v1. The maintainer's AWS account pays for it.

Forge LLMs (@forge/llm) was considered and rejected: it has no free usage allowance and is billed per credit to the developer. The Codegeist 2026 resources offer no LLM credits.

Egress:

· Declare only https://bedrock-mantle.us-east-1.api.aws, as a top-level remotes entry (key bedrock-mantle, operations: fetch) referenced from permissions.external.fetch.backend as remote: bedrock-mantle. The plain-string form of fetch.backend is deprecated (forge lint warning, CLI 14.2.0). Adding it is a major version upgrade ("data residency or egress modification").
· Codegeist 2026 has no Runs on Atlassian bonus, so egress affects no prize eligibility. The install screen discloses the external egress to admins.

Credential:

· MANTLE_API_KEY is a Forge encrypted environment variable (forge variables set --encrypt -e <environment> MANTLE_API_KEY), set by the maintainer per environment.
· One key per environment covers every installation of that environment. Judges configure nothing.
· Never in code, manifest, KVS, logs, git history, or panel or MCP output (§18.8).
· Request header: Authorization: Bearer <key>. Normal TLS certificate validation; never disable it. Verified: the endpoint completes a normal TLS handshake from Node fetch (HTTP 401 without a key).

Call:

· Runs only in the build job (queue consumer, 600 s timeout), never on the panel or MCP read path.
· Called only when a bundle is rebuilt for a changed fingerprint (§8.2), so repeated events do not each cost a call.
· Temperature 0.
· Model: qwen.qwen3-235b-a22b-2507 via POST /v1/chat/completions. Fallback on a provider error: deepseek.v3.2 (same endpoint). Chosen in a local test on real ITS-6265 text: valid structured output with both a forced tool call and JSON schema, about 2.3 s, and the most verbatim claims of the models tested (DeepSeek v3.1 and v3.2, Nemotron Super, gpt-oss-120b).
· Structured output: a forced tool call (tool_choice naming the claims function) with a JSON schema for { claims: [{ text, source }] }. Validate the arguments strictly anyway. Output that fails validation is a generation failure.
· Verified locally only, not yet from the Forge runtime: model availability, structured output, latency. The key is not allowed on bedrock-runtime (HTTP 400 "Operation not allowed"), so Mantle is the endpoint. Claude models are listed on Mantle but reject /v1/chat/completions; they need the Anthropic Messages API and are not used.
· Sources are given to the model under opaque labels (S1, S2, …). The model cites labels; the app maps each label back to its SourceRef. An unknown label becomes citedSourceRef: null, so the claim is omitted (§13.6).
· Ticket and source text are untrusted input. A prompt injection can only produce claims, and a claim is shown only with a matching span in its cited, authorized source.

Failure:

· Missing key, HTTP error, timeout, or invalid output: no summary is stored. Source sections render as normal (§13.3). Record the failure at debug level only; never log the key or the request body.

Data handling (§12.3 applies):

· Send only the minimum text: ticket summary and description, and the stored incident and resolution excerpts. No account IDs, emails, display names or URLs.
· The README and submission disclose that ticket and source excerpts are sent to Amazon Bedrock (AWS us-east-1) for summary generation.

Cost:

· Billed to the maintainer's AWS account, including judge usage.

---

13. Source-span matching

13.1 Guarantee

Every displayed generated claim must contain at least one verbatim normalized text span from its cited source and the source must be authorized for the current viewer.

Both conditions are required. These are one rule, not two. A claim satisfying only the span condition is dropped, not shown redacted.

This guarantees a text match only. It does not prove semantic entailment, and it does not prove the claim is universally true.

13.2 Implementation — authorization-first sequence

The sequence below is authoritative. §13.6 describes the same sequence from the perspective of disclosure rules; where the two appear to differ, this section governs the algorithm and §13.6 governs what may be returned to a viewer.

For each generated claim:

1. Resolve the cited source. If the claim's citedSourceRef is null or does not resolve to a source that currently exists, the claim is omitted entirely (§13.6 step 1).
2. Authorize the current viewer for the cited source under §16. If the viewer is not authorized, the claim is omitted entirely (§13.6 step 2). No text, no citation metadata, no rejection reason is returned.
3. Retrieve the currently available source text. Use the live source text at read time, not a copy cached on the bundle. A claim verified against stale text is not verified against the source as it currently exists.
4. Normalize both the claim and the retrieved source text identically:
   · Collapse runs of whitespace to a single space.
   · Case-fold.
   · Strip Markdown formatting where appropriate (headings markers, emphasis markers, inline code fences).
5. Find the longest common substring between the normalized claim and the normalized source text, or an exact sentence match.
6. Require a matching span of at least MIN_SPAN_CHARS (default 12) and MIN_DISTINCTIVE_WORDS (default 2).
6a. Require coverage: the qualifying spans shared with the cited source (each meeting step 6; several separate spans may count) must cover at least MIN_COVERAGE (default 0.5) of the claim's distinctive words. A long claim that shares only a short phrase with its source is not supported by it.
7. Classify the outcome:
   · No qualifying span, or coverage below MIN_COVERAGE → RejectedClaim with reason: 'no-matching-span'.
   · Qualifying span and sufficient coverage → surviving claims, with the matched span and source reference persisted in the response.
8. Persist the matching span and source reference for surviving claims.

Normalization must be applied identically to the claim and the source text. A claim that only matches after normalization is treated as grounded; a claim that only matches before normalization is not.

MIN_SPAN_CHARS is a named constant. Do not inline it. Short spans match on common phrases (for example, "the user cannot") and produce false positives.

MIN_COVERAGE is a named constant. Why it exists (local test, Qwen3-235B on the ITS-6265 demo data): with step 6 alone, claims such as "The agent could check whether the incident has been updated … and ensure the requester is directed to the StatusPage" were shown because they contained "certificate expiry", 2 of 31 words. Known cost: matching is on words, not meaning, so a correct claim the model reworded (for example "renewing … reloading" for "renewed … reloaded") can fall below MIN_COVERAGE and be rejected. That is accepted: the verifier only shows claims it can match to the source's wording, and the generation prompt (§13.6) asks for the source's own wording to keep this rare.

Source text may remain ephemeral rather than being persisted. Persist only the matching span and source reference.

Step order matters. Steps 1 and 2 are omissions, not rejections. Only claims that survive steps 1–3 can appear in the rejected list. A claim whose source is unresolvable or unauthorized never reaches the span check and is never disclosed to the viewer in any form.

13.3 Failure

If every generated claim is dropped:

· Omit the summary field from the bundle entirely.
· Continue rendering source sections.
· Do not fabricate citations.
· Do not show an empty summary with zero claims.

This is a valid, demonstrable state. It proves the guard is working.

13.4 UI terminology

Permitted:

3 claims with matching source spans

Never:

3 of 3 claims verified

Never describe dropped claims as "unverified" in a way that implies verification was attempted and failed for reasons other than span absence or authorization. The only rejection reason a viewer ever sees is no-matching-span.

13.5 Tests

Required tests, all under tests/domain/verify.test.ts:

· Exact sentence match passes.
· Whitespace-normalized match passes.
· Markdown-wrapped source passes after normalization.
· Controlled paraphrase with no qualifying span fails.
· Empty source fails.
· Match shorter than MIN_SPAN_CHARS fails.
· Claim whose cited source is unresolvable (citedSourceRef: null) is omitted entirely — not in claims, not in rejected.
· Claim whose cited source is unauthorized for the viewer is omitted entirely — not in claims, not in rejected.
· Common boilerplate (for example, "the user cannot") is not sufficient evidence on its own.
· A long claim whose only qualifying span covers less than MIN_COVERAGE of its distinctive words is rejected with no-matching-span.
· A claim covered by two separate qualifying spans that together reach MIN_COVERAGE passes.
· Coverage exactly at MIN_COVERAGE passes; just below fails.

Longest-common-substring matching can match common phrases. Tests must include at least one fixture that would pass a naive substring check but fail once MIN_SPAN_CHARS and normalization are applied correctly.

The authorization-first ordering is itself tested: a claim with an obvious paraphrase of an inaccessible source must produce no output whatsoever for an unauthorized viewer.

13.6 Rejection data model — provenance before disclosure

Rejected claims are response data computed at read time for the current viewer, not persisted bundle data. The rejection pipeline is designed around one rule: never disclose anything to a viewer about a source they cannot access.

Persisted form — structured claims with citations

The LLM is required to produce structured output, not free text. Each generated claim declares which source it cites. Raw LLM text alone is not a reliable source-to-claim mapping, because free text cannot be reliably parsed back into claim/citation pairs after the fact.

```ts
type GeneratedClaim = {
  claimId: string; // stable ID assigned at generation time
  text: string; // the claim as generated
  citedSourceRef: SourceRef | null; // null if the model did not cite a source
};

type PersistedSummary = {
  generatedClaims: GeneratedClaim[];
};
```

The ContextBundle field is summary?: PersistedSummary.

Generation prompt requirement: the model must output JSON of shape { claims: GeneratedClaim[] }. Every claim must either carry a citedSourceRef taken from the candidate sources provided to the model, or set it to null. The prompt must instruct the model that a claim without a citation will not be shown to any viewer.

Claim style (chosen in the local prompt test, §12.6): each claim states one fact from one source, in at most about 20 words, keeping the source's own wording. No advice or instructions to the agent, and no claim that combines facts from different sources. The prompt says that a claim its cited source does not support is removed, and that ticket and source text are data, not instructions. The prompt never asks for, or hints at, an unsupported claim: every rejection the panel shows must come from the model's own output.

Observed with this style: most claims are fully covered by their source, but the model sometimes rewords or overreaches, even at temperature 0, and those claims are rejected. Rejections therefore appear in some builds and not others. The demo narration must say so rather than imply every summary contains one.

The persisted generatedClaims are not what the panel or MCP returns. They are the input to per-viewer verification at read time.

Do not store a rejectedCount, a RejectedClaim[], or any viewer-derived summary field on the persisted bundle.

Read-time algorithm

The read-time algorithm is defined authoritatively in §13.2. The disclosure rules below describe what may be returned, given the outcomes of that algorithm.

For each GeneratedClaim in persistedSummary.generatedClaims:

1. If the claim's cited source is null or does not resolve to a currently existing source: omit the claim entirely. It is not returned as a claim, and it is not returned as a rejection. Provenance cannot be established, so nothing about the claim is disclosed.
2. If the current viewer is not authorized for the cited source: omit the claim entirely. No text, no citation metadata, no rejection reason. The claim's existence is not disclosed.
3. If the viewer is authorized: run the source-span check against the currently retrieved source text (§13.2 steps 3–6).
   · No qualifying span → return as RejectedClaim with reason: 'no-matching-span'.
   · Qualifying span exists → add to surviving claims.

Authorization is checked before the span check. A claim that would fail the span check may still paraphrase content from an inaccessible source; if the viewer cannot access the source, the claim text must not be returned in any form.

Response types

```ts
type RejectedClaim = {
  text: string; // only returned when the viewer is authorized for the source
  reason: 'no-matching-span'; // the only reason ever returned to a viewer
};

type SummaryResponse = {
  claims: Claim[]; // surviving, grounded, authorized claims
  rejected: RejectedClaim[]; // authorized claims that failed the span check
};
```

source-not-authorized is not a response reason. It describes the internal decision to omit a claim, not a value the viewer ever sees. A viewer of the panel or MCP response never learns that a claim existed about a source they cannot access.

What is explicitly forbidden

· Returning claim text, citation metadata, or a rejection reason for any claim whose cited source the current viewer cannot access.
· Returning a claim whose citedSource

Ref` is `null` or unresolvable, in any form.
- Running the span check before the authorization check.
- Verifying against a cached copy of the source text rather than the currently retrieved text.
- Caching a viewer-agnostic `rejectedCount` or `RejectedClaim[]` on the bundle.
- Treating the builder's authorization verdict as evidence for any viewer's authorization.

### Panel behavior

The panel displays the counter alongside the summary:

`3 claims shown · 1 rejected · [see why]`

- `3 claims shown` is the length of `claims` in the current viewer's `SummaryResponse`.
- `1 rejected` is the length of `rejected` in the current viewer's `SummaryResponse`.
- `[see why]` opens the viewer-specific `rejected` list.

The only rejection reason a viewer ever sees is `no-matching-span`, rendered in plain language as:

> "Removed: couldn't match this to the source's wording"

The wording covers both cases the verifier rejects: a claim its source does not support, and a true claim the model reworded too far from the source's wording (§13.2 step 6a). It must not suggest the fact is absent from the source.

Each shown claim's matching text is labelled "From the source:". The panel avoids technical terms such as span length; the precise rule is in §13.2.

A viewer with no access to a claim's source sees neither the claim nor any indication that it existed. The counter reflects only what the viewer is permitted to know.

This is deliberate: the trust contract's value to a viewer is that **nothing they see came from a source they cannot access, and the absence of a claim is indistinguishable from the claim never having been made.**

### Live summaries only — no canned summary in the app

The deployed app has no canned or hardcoded summary for any ticket, the demo ticket included. Every summary is generated by the LLM (§12.6) from the bundle's current sources during the build, and verified per viewer on every read. The panel is built entirely from that data. The canned demo summary added in step 8a is removed in step 8c, together with its "Demo fixture" label.

A rejected claim in the panel is therefore always one the model actually wrote. With the claim style in §13.6, most builds produce only covered claims; some produce a reworded or overreaching claim that is rejected. Which builds do is not controllable and must not be engineered: no prompt, ticket or source may be written to provoke a rejection.

Test fixtures are separate and still required. CI never calls the LLM (§19.7), so the integration tests use fixed generated claims, or a recorded LLM response, stored under `tests/`. These never ship in the app.

Do not use a `source-not-authorized` fixture for the demo. That condition is invisible to viewers by design and cannot be demonstrated without disclosing information a viewer should not see.

`tests/integration/verifier-rejection.test.ts` is the acceptance criterion (§19.6). It asserts:

- The `no-matching-span` path for an authorized source.
- The `citedSourceRef: null` path omits the claim entirely, with no effect on `claims` or `rejected` counts.
- The `source-not-authorized` path omits the claim entirely, with no effect on `claims` or `rejected` counts.
- The source text used for span matching is the currently retrieved text, not a cached copy.

These test claims exist only in the test suite. The submission write-up and the demo narration state that the summary shown is generated live and verified live, and that any rejection shown came from the model's own output.

---

# 14. Request clustering (Act 2, P1, conditional)

## 14.1 Purpose

Detect when multiple **open** requests share a confirmed service identity and a structured entity within a configurable window, and raise an emerging-incident signal before an incident is declared.

Clustering considers **open requests only**. Requests in a terminal state (resolved, closed, cancelled) are excluded from the grouping pass. An open request that subsequently closes is removed from the active cluster on the next pass; if the removal drops the cluster below threshold, the signal transitions to `expired`.

Clustering is additive. It attaches to the ContextBundle when a signal is active. It does not block Act 1.

When clustering is excluded from the submission, §14 does not apply, `cluster.ts`, `clusterPass.ts`, the clustering scheduled trigger and handler, the `get-emerging-incidents` MCP tool, and the emerging-signal panel UI are all omitted. No stubs remain.

## 14.2 Canonical identity sources — closed list

A cluster may be raised as **confirmed** only when both service identity and entity identity come from structured fields the architecture already established:

- **Service identity:** Assets object ID, or JSM service association. No other source.
- **Entity identity:** asset ID, component ID, or endpoint ID from a structured field. No other source.

Free-text mentions never establish either identity.

No new identity mechanisms may be introduced. If the existing architecture does not expose an identity source, that cluster is `uncertain` — not a signal to invent a new one.

## 14.3 Grouping rules — confirmed and uncertain

### Candidate set

The candidate set for any clustering evaluation is the **full set of open requests** in the project that share the canonical identity being evaluated within the window. No request is excluded from the candidate set because it participates in another cluster, is already the subject of a signal, or is otherwise "accounted for."

Evaluating each cluster against its full candidate set — rather than against a residual set after other clusters have claimed members — makes clustering deterministic. The result does not depend on processing order, and two clusters cannot silently overlap in a way that hides conflicting identities.

### Confirmed

A confirmed cluster requires both halves of the identity:

- Service identity is present and canonical.
- Entity identity is present and canonical.
- Both are shared across at least `threshold` distinct open requests within `windowMinutes`.
- No request in the candidate set has a **conflicting** canonical value for either identity.

"Conflicting" means a different non-empty canonical value for the same identity kind. Two requests with the same service ID and two different entity IDs are not compatible for a confirmed cluster. The cluster must not form across conflicting identities.

Two requests referencing the same canonical asset ID **and** the same service ID, plus enough other requests to reach threshold, produce a confirmed cluster — provided none of the requests carry a conflicting entity or service value.

### Uncertain

An uncertain cluster requires **at least one** half of the identity to be present, canonical, and shared across at least `threshold` distinct open requests in the candidate set, **and no conflicting known identity for the other half** anywhere in that candidate set.

- **Service-only uncertain:** every request in the candidate set that carries a known entity identity carries the **same** entity identity, or carries none at all. Missing entity identity is permitted. Conflicting known entity identities are not.
- **Entity-only uncertain:** every request in the candidate set that carries a known service identity carries the **same** service identity, or carries none at all. Missing service identity is permitted. Conflicting known service identities are not.

The rule is **missing is allowed; conflicting is not**.

Example — service-only uncertain. Five open requests reference service `S-001`. Three have no entity ID; two have distinct entity IDs `A-100` and `A-200`.

- The candidate set is all five requests sharing service `S-001`.
- The candidate set contains conflicting known entity identities (`A-100` and `A-200`).
- The service-only uncertain cluster does **not** form. The three entity-less requests are not extracted into a separate cluster by excluding the two entity-carrying requests.
- This is intentional: collapsing a set containing conflicting entities into a service-level uncertain signal would hide the fact that different requests concern different entities.

A service-only uncertain cluster does form when every request in the candidate set either lacks an entity identity or carries the same one. A set where every request lacks an entity identity is the canonical uncertain case.

The `reason` field on an uncertain `ClusterSignal` states which half of the identity is missing:

- `missing-entity-identity`
- `missing-service-identity`

### No residual-set exclusion

There is no mechanism for carving an uncertain cluster out of a residual set after confirmed clusters have been formed. The candidate set for every evaluation is the full set of open requests sharing the canonical identity within the window. If the full set contains conflicting known identities for the missing half, the uncertain cluster does not form — regardless of how many confirmed clusters those conflicting requests also belong to.

### What "present and canonical" means

Present: the structured field exists on the request and is non-empty after canonicalization.

Canonical: the value is the identifier form the source system exposes (§14.4), not a display name, derived key, or free-text mention.

### Idempotency across confirmed and uncertain

A cluster's `state` is determined at creation. A cluster created as `uncertain` because entity identity was missing is **not** promoted to `confirmed` when entity identity later appears on a new request. It remains `uncertain` for its lifetime and expires on window close. A new cluster may form as `confirmed` if the threshold is crossed again with full identity and no conflicting values.

Do not silently rewrite a signal's state. State is a stable property of a signal, not a live recomputation.

## 14.4 Canonicalization

Identities must be normalized and canonicalized before comparison:

- Trim whitespace.
- Case-fold.
- Use the canonical identifier form the source system exposes (for example, the Assets object ID as returned by the Assets API), not a display name or a derived key.
- Do not attempt fuzzy matching between identity values. Two distinct asset IDs are two distinct entities, even if their names look similar.

Canonicalization is deterministic and unit-tested. There is no heuristic step.

## 14.5 Configuration

Constants live in named configuration with sane defaults:

- `windowMinutes` — rolling observation window (default 90).
- `threshold` — minimum distinct open request count (default 5).

Both are configurable per project; defaults are used when unset.

The demo's "five additional requests" (§3.1) satisfies the default threshold. It is not a hardcoded product requirement.

## 14.6 Window identity

The deduplication key is `(projectKey, serviceId, entityKind, entityId, windowStart)`. `windowStart` is a stable anchor, not a rolling value.

When a cluster is first raised:

1. `windowStart` is set to the earliest `createdAt` among the requests in the cluster.
2. `windowEnd` is set to `windowStart + windowMinutes`.
3. Both values are persisted on the `ClusterRecord` and never modified for the lifetime of that signal.

A rolling window is used only for **evaluating** whether new requests belong to the existing signal. The persisted anchor does not drift. A request that arrives after `windowEnd` does not extend the current signal; it may contribute to a **new** signal with a new `windowStart`.

If a signal expires and a later cluster crosses threshold for the same identity, the new signal has a new `signalId` and a new `windowStart`. Deduplication does not treat it as the same cluster.

This prevents the key from changing on every clustering run, which would otherwise create duplicate signals for the same underlying cluster.

## 14.7 Signal lifecycle

A signal is created when the threshold is crossed and moves through:

- `raised` — threshold crossed, initial `windowStart` and `windowEnd` set.
- `updated` — new matching open request added within the window. `requestKeys`, `evidence`, and `lastUpdatedAt` change. `windowStart` and `windowEnd` do not.
- `resolved` — a human dismisses it or a matching incident is declared.
- `expired` — the current time exceeds `windowEnd` without a re-cross in a new window, or the open-request count drops below threshold because requests were closed or removed. The signal stops being shown.

The scheduled clustering trigger (§4.3) runs the clustering pass. Deduplication is by the stable key `(projectKey, serviceId, entityKind, entityId, windowStart)`. Creation is idempotent across repeated runs.

## 14.8 Idempotency

Repeated clustering runs over unchanged request state must produce no duplicate signals and no spurious `updated` transitions.

Idempotency is enforced by:

1. The stable deduplication key (§14.6).
2. Comparing the current `requestKeys` set on the existing `ClusterRecord` with the freshly computed set. If the sets are equal, no update is written, and `lastUpdatedAt` is not touched.

Do not write an `updated` transition solely because the clustering pass ran. Write it only when the `requestKeys` or `evidence` set actually changed.

## 14.9 Permission filtering

Signals are filtered at retrieval, not at display.

- The resolver and every MCP tool filter `requestKeys` and `evidence` to those the calling user can open.
- A viewer who cannot access a ticket must not learn it exists. If filtering drops `requestCount` below threshold for the caller, the signal is not returned to that caller.
- Evidence IDs are only returned for tickets the caller can access.
- The signal `serviceId` and `entityId` may be returned only if the caller can see at least the ticket that established them.

The persisted `ClusterRecord` stores the unfiltered set. The response `ClusterSignal` (§7.5) is always the filtered view for that caller.

## 14.10 Human review only

Outrider recommends investigation. It never:

- Declares an incident.
- Creates an incident.
- Assigns an owner.
- Writes back to JSM incident state.

The signal is advisory. A human decides.

## 14.11 Evidence pack

Each signal carries, per the response type in §7.5:

- `requestKeys` (permission-filtered).
- `evidence` entries with `evidenceId`, `ticketKey` and `matchedOn`.
- `windowStart` and `windowEnd`.
- `state` and, when uncertain, `reason`.

`matchedOn` identifies which structured field matched — for example, `assetId:<id>` or `serviceAssociation:<id>`. It is not free text.

The panel renders the evidence pack with the same source-link and freshness discipline as the four context sections.

## 14.12 Tests

Required only when clustering ships (see §19.3). Fixtures may configure a lower `threshold` for readability; state the configured threshold in each fixture so the test is self-describing.

- **Open requests only.** A request in a terminal state is excluded from grouping. A cluster that falls below threshold because requests closed transitions to `expired`.
- **Uncertain — no cluster from free text.** Two open tickets mentioning a shared word in the description, with no shared structured identity, produce **no signal**. Not `uncertain`, not `confirmed`.
- **Uncertain — service only.** Two open tickets (fixture threshold: 2) sharing the same canonical service ID but no shared entity ID, and **no conflicting known entity IDs** across the candidate set, produce an `uncertain` signal with `reason: missing-entity-identity`.
- **Uncertain — service only with conflicting entities.** Two open tickets sharing a canonical service ID but carrying two distinct entity IDs do **not** form a service-only uncertain cluster over the full candidate set. Conflicting known identity is not silently collapsed.
- **Uncertain — entity only.** Two open tickets (fixture threshold: 2) sharing the same canonical asset ID but no shared service ID, and **no conflicting known service IDs**, produce an `uncertain` signal with `reason: missing-service-identity`.
- **Uncertain — entity only with conflicting services.** Two open tickets sharing an asset ID but carrying two distinct service IDs do **not** form an entity-only uncertain cluster over the full candidate set.
- **Confirmed.** Two open tickets (fixture threshold: 2) sharing the same canonical asset ID and the same service ID, with no conflicting values, produce a `confirmed` signal.
- **Confirmed with default threshold.** Five open tickets sharing both identities, with no conflicting values, produce a `confirmed` signal at the default threshold.
- **Confirmed — conflicting identity blocks.** Two open tickets (fixture threshold: 2) sharing a service ID but carrying two different entity IDs do **not** form a confirmed cluster.
- **Different IDs, similar names.** Two open tickets referencing two different asset IDs with similar display names do not cluster.
- **Threshold crossing.** First crossing produces a signal; re-running the same window does not produce a duplicate.
- **Update, not duplicate.** Adding a request within an active window produces an `updated` transition, not a second signal. `windowStart` and `windowEnd` do not change.
- **Window anchor stability.** Repeated runs over unchanged state do not rewrite `windowStart` or `windowEnd`.
- **Expiry and re-cross.** Window expiry transitions the signal to `expired`; a later re-cross for the same identity produces a new `signalId` with a new `windowStart`.
- **No silent promotion.** An `uncertain` signal is not promoted to `confirmed` when a later request adds the missing identity half.
- **Permission filtering at retrieval.** A viewer cannot learn that inaccessible tickets exist, and cannot see evidence IDs for inaccessible tickets.
- **Authorization parity.** `get-emerging-incidents` enforces the same authorization rules as the panel.

```markdown
---

# 15. MCP tools

Expose exactly three core tools. The fourth is conditional on clustering shipping.

## 15.0 Response contract

Each tool has its own response shape. Do not force unrelated tool results into a `ContextBundle`.

| Tool | Response shape |
|---|---|
| `get-ticket-context` | `ContextBundle` (viewer-filtered) or `PendingContext` (cold start) |
| `find-related-incidents` | `{ incidents: Incident[] }` (viewer-filtered; §15.3a) |
| `find-similar-resolutions` | `{ resolutions: Resolution[] }` (viewer-filtered; §15.3a) |
| `get-emerging-incidents` (conditional) | `ClusterSignal[]` (viewer-filtered) |

The tools share the domain types defined in §7 and the authorization logic defined in §16. They do not share a single response envelope. A tool that returns incidents returns incidents, not a bundle with an incidents field and everything else empty.

All tools apply read-time authorization before returning. The authorization rules in §16 apply to every tool without exception.

## 15.1 get-ticket-context

Input:

- `ticketKey` (required).

### Authorization gate — before any other check

Before checking whether a bundle exists, before enqueueing a build, and before returning a pending response, authorize the invoking user for the Jira ticket:

1. Identify the caller from the authenticated MCP invocation context.
2. Check the caller's access to the ticket.
3. If the caller cannot access the ticket, return an authorization failure. Do **not** enqueue a build, return a pending response, or disclose whether a bundle exists for that ticket.

This ordering is mandatory. An unauthorized caller must not be able to trigger builds, learn that a bundle exists, or receive any signal that distinguishes a ticket with a bundle from one without.

### After authorization succeeds

If no bundle exists for the ticket:

1. Enqueue a build (`jira-ticket` job).
2. Return the defined pending response.
3. Do not run the entire pipeline synchronously inside the action.

```ts
type PendingContext = {
  status: 'pending';
  ticketKey: string;
  buildId: string;
  requestedAt: string;
  message: string;
};
```

This is the only cold-start response shape. Do not invent an alternative.

If a bundle exists and the caller is authorized, apply read-time filtering (§16) to every source in the bundle before returning it:

· Jira incidents and resolutions: re-authorize per viewer.
· Confluence articles: re-authorize per viewer.
· Teamwork Graph service links: re-authorize per viewer via a fresh TWG lookup (§11.6).
· Summary claims: run the read-time algorithm in §13.2 for this viewer.
· Emerging incident signal (if present): apply the permission filtering in §14.9 for this viewer.

The response's partial flag is set to true when at least one source was dropped or failed re-authorization for this viewer, even if the persisted bundle was complete when built. The response's failures array carries viewer-specific failure identifiers (for example, twg:viewer-not-authorized) alongside any persisted build failures.

15.2 find-related-incidents

Input:

· ticketKey (optional) or keywords (optional). At least one is required.

Returns an Incident[] ranked by the same retrieval engine used for the ticket bundle, wrapped as described in §15.3a. It does not return a ContextBundle.

Each result carries:

· Incident summary.
· Source URL.
· Freshness (startedAt or source.updatedAt).
· Relevance information.

Read-time authorization applies. If ticketKey is supplied and the viewer cannot access the ticket, return an authorization failure. If keywords are supplied, results are filtered to incidents the viewer can access; incidents they cannot access are not returned, and their existence is not disclosed.

Empty results are valid. Return [], never a fabricated item.

15.3 find-similar-resolutions

Input:

· ticketKey (optional) or description (optional). At least one is required.

Returns a Resolution[] ranked by the same retrieval engine, wrapped as described in §15.3a. It does not return a ContextBundle.

Each result carries:

· Resolution text.
· Source URL.
· Freshness (resolvedAt).
· Match reason (same-requester, same-symptom, both).

Read-time authorization applies. Same rules as §15.2: a supplied ticketKey the viewer cannot access returns an authorization failure; keyword-only queries filter out inaccessible resolutions without disclosing their existence.

15.3a Response wrapper for the find tools (deliberate extension, step 9)

find-related-incidents returns { incidents: Incident[], partial: boolean, failures: string[] } and find-similar-resolutions returns { resolutions: Resolution[], partial: boolean, failures: string[] }, instead of a bare array. The lists are exactly the Incident[] and Resolution[] above. The wrapper lets an agent tell "nothing found" (an empty list) from "no access" (the same not-accessible shape get-ticket-context uses) and from "could not check" (partial: true, with an empty list). It is still not a ContextBundle.

Agreed behaviour for both tools:

· Live retrieval on every call, never the stored bundle, so tickets that never get a bundle (for example ITO incidents) work.
· Ticket and free text together: the ticket wins; the text is a hint appended to its description. Text alone gives a symptom-only query. The issue the user is viewing is used only when no input is given at all.
· At most 5 results (MAX_TOOL_RESULTS), the same as the panel shows per section, applied after filtering.
· A failed visibility check returns an empty list marked partial with auth:jira-check-failed, never unfiltered results.

15.4 get-emerging-incidents (conditional — only when clustering ships)

Input:

· projectKey (optional).
· serviceId (optional).

Returns a ClusterSignal[] for the caller, applying the permission filtering in §14.9. It does not return a ContextBundle.

If clustering is excluded from the submission, this tool and its manifest action are both omitted.

Same authorization discipline: signals the viewer cannot see are not returned, and their existence is not disclosed. Signals whose requestKeys fall below threshold after filtering for the caller are not returned to that caller.

15.5 MCP implementation rules

· Each tool returns its own typed result, not a shared envelope. Domain types in §7 are shared; the response envelope is not.
· Structured data, not conversational prose. The calling agent composes the narrative. Every result carries source URL and freshness so the agent can cite.
· Thin action handlers. Handlers invoke the shared retrieval and authorization logic. They do not re-implement either.
· Empty results are valid. Return [] or an empty section. Never fabricate an item to fill a section.
· Never use user-supplied input as proof of authorization. A supplied ticketKey, keywords, serviceId or projectKey identifies a target; it does not grant access to that target.
· Enforce access for the actual invoking user. Caller identity comes from the authenticated MCP invocation context, not from any input field.
· Authorize before side effects. Authorization must succeed before a build is enqueued, a pending response is returned, or any existence information is disclosed.
· Never return cached content merely because another user built it. A bundle built by user A is not automatically safe to serve to user B.
· Do not return ticket context to a caller who cannot access the ticket. Return an authorization failure; do not return the pending shape as a disguise.
· Apply source-level Confluence authorization to every article returned.
· Re-authorize Jira incidents and resolutions for the current viewer even when the caller can access the parent ticket.
· Do not rely on the build actor's identity as authorization. Re-authorize for the current viewer (§11.6 for TWG, §16 for everything else).
· Do not disclose the existence of inaccessible resources. A failure to return an item must be indistinguishable from the item never having existed.

Verify the actual Rovo MCP invocation context and authorization mechanism against the installed Forge environment and current documentation. The caller's identity is not guaranteed to be available in a form the spec assumes until that is verified.

---

16. Authorization and data security

Authorization is mandatory, not a post-MVP enhancement.

The persisted bundle is shared and unfiltered. The response is constructed for the calling user by applying authorization at read time. The resolver never returns the persisted bundle directly.

16.1 Panel

Before returning a bundle to the panel:

· Identify the current panel user from the authenticated context.
· Check access to the Jira ticket. If the viewer cannot access the ticket, return an unauthorized state (§17.1) with no bundle content.
· For every Jira incident and resolution returned, re-authorize access for the current viewer. Do not assume access to the parent ticket grants access to every related source. A viewer who can see the ticket may not have access to a linked incident or a past resolution in another project, another space, or another restricted context.
· For every Confluence source whose excerpt or content would be returned, check access for the current viewer.
· For every Teamwork Graph ServiceLink, re-authorize the current viewer via a fresh TWG lookup (§11.6). Account-ID equality with resolvedForAccountId is not sufficient.
· For every generated claim in the summary, run the read-time algorithm in §13.2, which checks authorization before span evaluation.
· For every emerging-incident signal, apply the permission filtering in §14.9 for the current viewer.

Filter or omit inaccessible content. Do not return redacted citations or placeholders that disclose the existence of content the viewer cannot access.

16.2 MCP

Apply equivalent checks to every MCP tool.

Caller identity must come from the authenticated MCP invocation context.

Never trust any of the following as authorization proof:

· A supplied account ID.
· A supplied ticket key.
· A supplied serviceId or projectKey.
· builtByAccountId or resolvedForAccountId on a stored object.
· The original event actor recorded on the bundle.
· The identity of whoever triggered the build.

16.3 Cache

A shared cached bundle is not automatically safe for every reader.

Re-evaluate source access at read time. Permission revocation must take effect even when the bundle was built before the revocation.

Read-time authorization cost is proportional to the number of returned sources and the number of ServiceLink entries requiring a fresh TWG lookup.

· Per-source checks (Jira, Confluence): acceptable at demo scale, where each section contains at most five items.
· TWG re-authorization: bounded by wall-clock time as specified in §11.6, not only by call count.

Production scale would require a carefully designed permission cache with explicit revocation handling. Do not attempt to build such a cache for the hackathon submission. Document the cost characteristics and move on.

16.4 Filter at retrieval

The persisted bundle is shared and unfiltered. The response is constructed for the calling user by applying authorization at read time. The resolver never returns the persisted bundle directly.

Concretely:

· The panel resolver reads the persisted bundle, then constructs a filtered response for the current viewer.
· Every MCP tool does the same.
· The persisted bundle is never returned directly. Only the filtered response is returned.
· The filtering happens on the server side, inside the resolver or MCP action, before the response leaves the app. The panel UI does not perform filtering.

This applies to every category of content: incidents, resolutions, articles, service links, summary claims, and emerging-incident signals.

16.5 Failure handling

If an authorization check itself fails (for example, a timeout calling the permission API, a transient error from TWG, or an unresolvable source reference):

· Treat the item as inaccessible for this viewer.
· Drop the item from the response.
· Record a failure identifier (auth:<category>-check-failed) in the response's failures array.
· Set the response's partial flag to true.
· Do not fall back to returning the item without authorization. "Could not verify" is treated as "not authorized."

This is a deliberate conservative default. The cost of a false negative (a viewer temporarily does not see an item they could access) is much lower than the cost of a false positive (a viewer sees an item they should not access).

16.6 Required security tests

All of the following must pass before authorization is considered complete. These live in tests/integration/:

1. Two-user bundle isolation. User A can access a Jira ticket and all its Confluence sources. User B can access the ticket but not one Confluence source. User B must not receive the restricted excerpt.
2. Ticket-level denial. User C cannot access the Jira ticket. User C must not receive the bundle, must not receive the pending shape as a disguise, and must not learn that a bundle exists.
3. Revocation after build. User A initially has access, then loses access to a Confluence page. After revocation, User A must not receive the restricted content, even though the persisted bundle still contains it.
4. MCP caller isolation. A different MCP caller must not inherit the build actor's permissions. A caller with no access to the ticket must receive an authorization failure, not a filtered bundle.
5. TWG re-authorization — different viewer. A ServiceLink resolved by user A must not be served to user B without a fresh TWG lookup as user B. If user B's lookup fails or shows no matching relationship, the link is dropped for user B.
6. TWG re-authorization — original viewer after permission change. A ServiceLink resolved by user A must not be served to user A without a fresh TWG lookup. If user A's permissions have changed since the build, the link is dropped for user A.
7. Summary claim disclosure — unauthorized source. A generated claim whose cited source is not authorized for the viewer must be omitted entirely, with no effect on the viewer's claims or rejected counts, and no disclosure that the claim ever existed.
8. Summary claim disclosure — unresolvable source. A generated claim whose citedSourceRef is null or unresolvable must be omitted entirely, with no effect on the viewer's claims or rejected counts.
9. Emerging signal filtering. A viewer cannot learn that inaccessible tickets exist within a cluster, and cannot see evidence IDs for inaccessible tickets. A signal whose visible requestKeys fall below threshold after filtering is not returned to that viewer.
10. Jira-source isolation beyond ticket access. A viewer with access to the ticket but not to a linked incident or a past resolution must not receive that incident or resolution. Access to the parent ticket is not access to related sources.
11. Conservative default. When an authorization check itself fails, the item is dropped and the response is marked partial. It is not returned without authorization.

Each test asserts both the positive (authorized content is returned) and the negative (unauthorized content is not returned, and its existence is not disclosed).

---

17. Panel UI

Use UI Kit, not Custom UI.

The panel is a read-only presentation of the latest stored context, filtered for the current viewer. It must never trigger a full retrieval pipeline. Panel-open does not enqueue a build.

17.1 States

State Trigger Presentation
No bundle No stored bundle for this ticket Concise empty state: "Context is being prepared. Check back shortly."
Queued Stored status is queued "Context assembly is queued."
Building Stored status is building "Context is being assembled."
Complete Stored status is complete, bundle present, viewer authorized Render the four sections and summary (if present) per §17.2–§17.4.
Partial Bundle present but partial: true after viewer filtering Render the available sections plus a compact notice identifying unavailable sources. Do not name sources the viewer cannot access.
Failed Stored status is failed Concise failure state: "Context could not be assembled." No error detail beyond a generic message.
Superseded Stored status is superseded "A newer version is being prepared." Keep the last available bundle visible if present.
Unauthorized Viewer cannot access the ticket Do not render bundle content. Show a generic unavailable message. Do not disclose that a bundle exists.
Emerging signal (conditional) emergingIncident present after viewer filtering Render a signal card above the four sections.

A state must never disclose content the viewer is not authorized to see. A Partial state notice does not name the unavailable source category if doing so would reveal that a source exists that the viewer cannot access. In that case, the notice says "Some sources are unavailable" without further detail.

17.2 Sections

The panel renders four sections in a fixed order:

1. Active incidents.
2. Past resolutions.
3. Knowledge articles.
4. Affected services.

Each item displays:

· Title.
· Useful snippet (does not include content the viewer cannot access).
· Source link.
· Freshness (startedAt, resolvedAt, source.updatedAt, or lastUpdatedAt as applicable).
· Relevance indicator (a simple visual weight; not a numeric score shown to the user).

Empty sections are rendered with a brief "No items" message. Do not hide empty sections; a viewer should be able to see that the section was evaluated and returned no results.

Sections that are unavailable because of authorization filtering are rendered as empty, indistinguishable from a genuinely empty section. This is the same principle as §16.4: absence must not disclose existence.

17.3 Summary

If a summary exists after viewer filtering (§13.2 read-time algorithm):

· Display surviving source-matched claims.
· Show the counter: N claims with matching source spans.
· Provide a Show sources control per claim, expanding to the exact matched span and source link.
· Show the rejected-claim counter: M rejected · [see why].
· The [see why] toggle opens the viewer-specific rejected list, showing only no-matching-span rejections, each struck through with "Removed: couldn't match this to the source's wording" (§13.6).

If no summary exists after filtering:

· Do not render an empty summary.
· Do not render a counter with zero values.
· Do not render a "no summary" placeholder. The absence of a summary is not information the viewer needs.
· Render the four sections only.

This is consistent with §13.3: if every claim is dropped or omitted, the summary is absent, not empty.

17.4 Emerging signal (conditional)

If emergingIncident is present after viewer filtering:

· Render a signal card above the four sections.
· Show the signal state (confirmed or uncertain).
· Show the service and/or entity the signal concerns.
· Show windowStart and windowEnd.
· Show the evidence pack (permission-filtered).
· For uncertain signals, show the reason.
· Provide a Recommend investigation affordance.

The signal card never declares an incident. It never creates one. It never assigns an owner. It is advisory.

If the signal's requestKeys fall below threshold after filtering for this viewer, the signal is not rendered at all. Do not render a dimmed or partial signal.

17.5 Freshness

Show the bundle's builtAt time.

If a newer build is pending or in progress, retain the last available bundle but indicate that it may be out of date. The indicator must be visible without requiring interaction.

Never show stale data as if it were current. Never hide the freshness timestamp.

17.6 Refresh

If the bundle is missing:

· Render the building or empty state immediately.
· Poll once after approximately five seconds.
· Do not create a long-running spinner.
· Avoid uncontrolled polling.

If the bundle is present, do not poll. The panel reflects the last-completed bundle.

If UI Kit does not support the proposed refresh mechanism in the target environment, use the simplest supported mechanism. Note which mechanism was used in the submission write-up.

17.7 Links and interactions

All source links open in a new tab. Source links point to the current location of the source (after moves and renames are applied).

No panel interaction mutates bundle content. Interactions available in the panel:

· Opening a source link.
· Expanding a claim's matched span.
· Opening the rejected-claim see why list.
· Dismissing an emerging signal (which writes to the ClusterRecord under §14.7, not to the bundle).
· Clicking Recommend investigation on an emerging signal (which does not create an incident; it is a UI affordance that records the recommendation).

The panel does not offer:

· Manual re-build triggers.
· Source editing.
· Incident creation.
· Claim editing.

17.8 Accessibility and localization

The panel is English-only for the MVP (§3.4). Accessibility is best-effort using UI Kit primitives. Do not introduce custom rendering that bypasses UI Kit's built-in accessibility unless a specific need is documented.

---

18. Storage

18.1 Namespaced keys

Use @forge/kvs for application storage. Declare storage:app.

Suggested namespaced keys:

```text
bundle:<ticketKey> # persisted ContextBundle (unfiltered)
status:<ticketKey>  
Continuing §18 from where the copy cut off:

```markdown
status:<ticketKey> # BuildStatus
lock:<ticketKey> # per-ticket lock record
index:<spaceOrProject>:<kind:id> # IndexRecord per source
checkpoint:<indexType> # reindex / reconciliation cursors
checkpoint:ticket-reconciliation # ticket reconciliation cursor
cluster:<clusterKey> # ClusterRecord (P1, conditional)
# see §18.7 for clusterKey format
secret:<provider> # NOT for credentials; only for opaque
# references if the environment requires it
```

The secret:<provider> entry must not contain credentials. Credentials belong in Forge's dedicated secure secret storage. The namespaced KVS key is for an opaque reference or configuration pointer, not for the secret value itself.

18.2 Bundle storage

The persisted bundle is unfiltered by viewer. Filtering happens at read time (§16.4). The persisted bundle contains:

· Incidents, resolutions, articles, service links as retrieved at build time.
· ServiceLink entries carry resolvedForAccountId (§11.6).
· summary?: PersistedSummary with generatedClaims (§13.6), not viewer-derived fields.
· No rejectedCount or RejectedClaim[].

Do not persist full source text unless it is required for a specific read-time operation. Source text for verification (§13.2) is retrieved live at read time, not stored on the bundle. Only the matched span for surviving claims is persisted on the response, not on the bundle.

18.3 Status storage

status:<ticketKey> stores the latest BuildStatus (§7.4). One record per ticket.

Concurrent writes to status follow the guard in §6.2 and §8.7: write only if the current record still belongs to this build ID and its state is the expected predecessor state. This is best-effort.

18.4 Lock storage

lock:<ticketKey> stores the lock record (§8.5). One record per ticket.

The lock record is released by §8.5 rule 5 (release only if the current lock still belongs to the releasing build). Crashed consumers leave expired locks, which reconciliation (§8.7) cleans up.

18.5 Index storage

index:<spaceOrProject>:<kind:id> stores the IndexRecord (§10.1). One record per indexed source.

Index records are written by the indexing pipeline (§10) and read during ticket retrieval. They are not returned to any viewer directly. Serving indexed content is a separate authorization step (§16).

The vector field is optional and carries the embedding if one was successfully generated (§12).

18.6 Checkpoints

Checkpoints track the progress of long-running reconciliation passes:

· checkpoint:confluence-index — the Confluence reconciliation cursor (§10.8).
· checkpoint:ticket-reconciliation — the ticket reconciliation cursor (§8.7).

Each checkpoint stores the last-inspected identifier and the timestamp of the last completed batch. A run that finishes a full pass resets the checkpoint to the beginning on the next run (§8.7 stale-bundle discovery).

18.7 Cluster storage key (P1, conditional)

The cluster storage key must encode the full §14.6 identity tuple, including the cluster type and the presence or absence of each identity component. Uncertain clusters legitimately have a missing service identity or a missing entity identity, so the key must represent "absent" unambiguously.

Format:

```text
cluster:<projectKey>:<identityType>:<serviceIdEnc>:<entityKindEnc>:<entityIdEnc>:<windowStartEnc>
```

Where:

· identityType is one of confirmed, uncertain-service-only, uncertain-entity-only.
· serviceIdEnc, entityKindEnc, entityIdEnc are percent-encoded values, or the literal token - when the component is absent. Percent-encoding is required because identifiers may contain delimiters (:, %, /, whitespace).
· windowStartEnc is the ISO-8601 windowStart string, percent-encoded. It is not a rolling value (§14.6).
· projectKey is percent-encoded.

Examples:

```text
cluster:PAY:confirmed:S-001:asset:A-100:2026-12-04T10%3A00%3A00Z
cluster:PAY:uncertain-service-only:S-001:-:-:2026-12-04T10%3A00%3A00Z
cluster:PAY:uncertain-entity-only:-:asset:A-200:2026-12-04T10%3A00%3A00Z
```

Rules:

· A literal - is reserved for "absent." Identifiers that percent-encode to - must use %2D to distinguish them from an absent component.
· identityType is derived from which components are present, per §14.3.
· The encoding must be reversible. A single decodeClusterKey function must round-trip every key the system produces.
· Two clusters with the same projectKey, identityType, component values, and windowStart are the same cluster. Two clusters differing in any component (including presence vs. absence) are distinct.
· Do not collapse uncertain-service-only and uncertain-entity-only into a shared key space. Their identity semantics differ.

The key format is a storage detail. It does not change the clustering model in §14. The §14.6 identity tuple remains the source of truth for deduplication; §18.7 is its storage representation.

18.8 Secret storage

Provider credentials (§12.2) are stored in Forge's secure secret storage, not in KVS.

The KVS key secret:<provider> is a configuration pointer, not a credential. Its value may identify which secure secret entry to read, but must not contain the secret itself.

Never place credentials in:

· KVS values.
· manifest.yml.
· Source files.
· Plain-text configuration.
· Git history.
· Logs.
· Error messages returned to the panel or MCP.

18.9 Atomicity

Do not assume KVS supports atomic compare-and-set unless the installed package's documentation explicitly states it does. The concurrency design (§8.5–§8.7) is best-effort and does not depend on atomicity.

If a specific KVS operation is found to be atomic after verification, it may be used to strengthen the guarantees in §8.6, but doing so requires a spec change, not an implementation choice. Do not silently strengthen the guarantee.

18.10 Retention

· Bundles are overwritten on each successful build for a ticket. There is no history.
· Status is overwritten on each build transition. There is no history.
· Locks are released on build completion or expiry.
· Index records are replaced on refresh and removed on invalidation.
· Checkpoints persist across runs and are reset on completed passes.
· Cluster records (P1) are retained for clusterRetentionHours (default 168) after expiry.
· Failure diagnostics are stored at debug level only and are not exposed to the panel or MCP.

```
```markdown
---

# 19. Testing

## 19.1 Domain tests

Target 100% branch coverage for:

- Entity extraction.
- Scoring and normalization (§9.1 `normalizeCosine` is tested for negative, zero, one, out-of-range, and NaN inputs).
- Source-span matching (§13.2 steps 4–6).
- Fingerprint projection (§8.2) including deterministic array ordering.
- Clustering canonicalization and grouping (§14.3, §14.4) — conditional on clustering shipping.

Domain tests have no Forge imports and no I/O. They run in CI without credentials.

## 19.2 Core pipeline tests (always required)

These tests run whether or not clustering ships. All are required.

### Ranking

- Active incident outranks resolved incident at equal similarity (status term).
- Higher relationship strength outranks lower at equal similarity.
- Recency decay is deterministic across fixed timestamps.
- Ties resolve by recency descending, then by composite source key ascending.
- Missing embeddings do not break ranking (`semanticSimilarity = 0` fallback).
- `normalizeCosine` maps negative values to 0 and values above 1 to 1.

### Verifier

Required tests live under `tests/domain/verify.test.ts`:

- Exact sentence match passes.
- Whitespace-normalized match passes.
- Markdown-wrapped source passes after normalization.
- Controlled paraphrase with no qualifying span fails.
- Empty source fails.
- Match shorter than `MIN_SPAN_CHARS` fails.
- Claim whose `citedSourceRef` is `null` is omitted entirely — not in `claims`, not in `rejected` (§13.6 step 1).
- Claim whose cited source is unauthorized for the viewer is omitted entirely — not in `claims`, not in `rejected` (§13.6 step 2).
- Common boilerplate (for example, "the user cannot") is not sufficient evidence on its own.
- A long claim whose qualifying spans cover less than `MIN_COVERAGE` of its distinctive words is rejected; two separate spans that together reach `MIN_COVERAGE` pass (§13.2 step 6a).
- Authorization-first ordering: a claim that paraphrases content from an inaccessible source produces no output whatsoever for an unauthorized viewer.
- Source text used for matching is the currently retrieved text, not a cached copy.

### Pipeline

- Jira event → Jira job → ticket bundle.
- Confluence event → page job → index update. *(conditional on Confluence availability; see §19.3)*
- Confluence delete → index deletion. *(conditional on Confluence availability; see §19.3)*
- A Confluence page ID never reaches Jira retrieval (enforced by the discriminated union in §6.1 and asserted by a test that routes a `confluence-page` job and asserts Jira retrieval is not invoked).
- One source failure does not block other sections (`partial: true`, other sections intact).
- Duplicate queue delivery is safe.
- Concurrent builds are handled with the documented best-effort protection (see §19.4).
- Ticket changes during build cause supersession.
- Failed queue insertion records `enqueue_failed` without overwriting `building`, `complete`, or `superseded` (§6.2 guard).
- All three core MCP tools return their own typed response (§15.0) and enforce the same authorization rules.

## 19.3 Conditional source tests (only when the source is included)

These tests are required when the corresponding integration is included in the submission. If the integration is omitted — for example, because Confluence is not available, or because clustering is cut — the tests in this section are not release blockers, and the corresponding manifest declarations are not required.

### Confluence integration (conditional on Confluence availability)

Required only if the submission includes Confluence retrieval:

- Real Confluence page read from the installed app.
- Index upsert, delete, trash, restore, move, and permission-change lifecycle.
- Restricted-page integration test (§16.6 test #1 variant using a real Confluence page).
- Permission revocation test (§19.5) executed against a real Confluence page.
- Reconciliation identifies and removes stale index records.

If Confluence is unavailable in the target environment, the submission claims a Jira-only scope: no Confluence articles section, no Confluence event triggers, and no Confluence scopes in the manifest. See §22 and §23.

### Clustering (conditional on clustering shipping)

Fixtures may configure a lower `threshold`; each test states its configured threshold so it is self-describing.

**Grouping**

- **Open requests only.** A request in a terminal state is excluded from grouping. A cluster that falls below threshold because requests closed transitions to `expired`.
- **Uncertain — no cluster from free text.** Two open tickets mentioning a shared word with no shared structured identity produce **no signal**. Not `uncertain`, not `confirmed`.
- **Uncertain — service only.** Two open tickets (fixture threshold: 2) sharing the same canonical service ID but no shared entity ID, and no conflicting known entity IDs across the full candidate set, produce an `uncertain` signal with `reason: missing-entity-identity`.
- **Uncertain — service only with conflicting entities.** Two open tickets sharing a canonical service ID but carrying two distinct entity IDs do **not** form a service-only uncertain cluster over the full candidate set.
- **Uncertain — entity only.** Two open tickets (fixture threshold: 2) sharing the same canonical asset ID but no shared service ID, and no conflicting known service IDs, produce an `uncertain` signal with `reason: missing-service-identity`.
- **Uncertain — entity only with conflicting services.** Two open tickets sharing an asset ID but carrying two distinct service IDs do **not** form an entity-only uncertain cluster over the full candidate set.
- **Confirmed.** Two open tickets (fixture threshold: 2) sharing the same canonical asset ID and the same service ID, with no conflicting values, produce a `confirmed` signal.
- **Confirmed with default threshold.** Five open tickets sharing both identities, with no conflicting values, produce a `confirmed` signal at the default threshold.
- **Confirmed — conflicting identity blocks.** Two open tickets (fixture threshold: 2) sharing a service ID but carrying two different entity IDs do **not** form a confirmed cluster.
- **Different IDs, similar names.** Two open tickets referencing two different asset IDs with similar display names do not cluster.
- **No residual-set exclusion.** A candidate set containing conflicting identities for the missing half does not produce an uncertain cluster by carving out a subset (§14.3).

**Lifecycle**

- Threshold crossing produces a signal; re-running the same window does not produce a duplicate.
- Adding a request within an active window produces an `updated` transition, not a second signal. `windowStart` and `windowEnd` do not change.
- Window anchor stability: repeated runs over unchanged state do not rewrite `windowStart` or `windowEnd`.
- Expiry transitions the signal to `expired`; a later re-cross for the same identity produces a new `signalId` with a new `windowStart`.
- No silent promotion: an `uncertain` signal is not promoted to `confirmed` when a later request adds the missing identity half.

**Storage and permission**

- `encodeClusterKey` / `decodeClusterKey` round-trip every key in §18.7's examples and every combination of absent/present components.
- Two clusters differing in any identity component (including presence vs. absence) have distinct keys.
- Permission filtering at retrieval: a viewer cannot learn that inaccessible tickets exist, and cannot see evidence IDs for inaccessible tickets.
- A signal whose visible `requestKeys` fall below threshold after filtering is not returned to that caller.
- `get-emerging-incidents` enforces the same authorization rules as the panel.

## 19.4 Mandatory concurrency integration test

File: `tests/integration/concurrent-build.test.ts`

Scenario:

1. Start two builds for the same ticket.
2. Give them different ticket fingerprints.
3. Make the older build finish later.
4. Allow both to contend for the same ticket lock.
5. Assert that, in the observed outcome, the newer fingerprint is the one stored after both builds finish.
6. Assert that the older build's write did not overwrite a newer persisted bundle in this interleaving.

**What this test proves and does not prove.** The test verifies that the specific interleaving exercised by the test is handled correctly by the best-effort locking and generation checks described in §8.5–§8.7. It does not prove that every possible interleaving is safe, and it does not establish an absolute guarantee of write ordering.

The concurrency design is explicitly best-effort (§8.5, §8.6, §18.9). KVS does not provide an atomic compare-and-set that the design relies on. The test is an acceptance criterion for the observed behavior, not a proof of mutual exclusion. Any submission write-up must describe the guarantee as **best-effort** and must not claim strict mutual exclusion. The reconciliation pass (§8.7) repairs observable consequences of races that slip through; it does not prevent them.

A test that passes must be reported as "handled in the observed interleaving," not "guaranteed under all interleavings."

## 19.5 Mandatory revoked-access integration test

File: `tests/integration/revoked-access.test.ts`

Scenario:

1. User A reads a bundle containing a source excerpt (Jira or Confluence, whichever the submission includes).
2. Revoke User A's access to that source.
3. User A reads the same bundle again.
4. Assert the restricted excerpt is absent from the second response.
5. Assert other still-authorized context remains available.

When the submission includes Confluence, the test uses a real Confluence page. When the submission is Jira-only, the test uses a restricted Jira source (a linked incident or past resolution the viewer can no longer access).

## 19.6 Mandatory verifier-rejection integration test

File: `tests/integration/verifier-rejection.test.ts`

Scenario:

1. Use fixed test claims (a test fixture under `tests/`, never shipped in the app; §13.6) whose cited source is **authorized for the test viewer**.
2. Include at least one claim with no qualifying source span.
3. Assert the unqualified claim is absent from the displayed summary.
4. Assert the rejected-claim counter reports the correct count.
5. Assert the rejection reason is inspectable and reports `no-matching-span`.
6. Include a second fixture claim whose `citedSourceRef` is `null`; assert it is omitted entirely with no effect on `claims` or `rejected` counts.
7. Include a third fixture claim whose cited source is **not** authorized for the viewer; assert it is omitted entirely with no effect on `claims` or `rejected` counts.
8. Assert the source text used for span matching is the currently retrieved text, not a cached copy.

This is the acceptance test for the P0 differentiator. It is not optional.

## 19.7 Adapter tests

Use recorded fixtures. No live Jira, Confluence, TWG or embedding calls in ordinary CI.

Adapters are tested for:

- Request construction (headers, scopes, query shape).
- Response parsing into domain types.
- Error mapping into `failures` identifiers.
- Degradation when the adapter is unavailable (§8.3 failure isolation).

## 19.8 Integration tests (environment-dependent)

These require a real Forge dev site and real Atlassian products. They are not part of ordinary CI but are required before submission for the integrations the submission includes.

**Always required (Jira-only submission included):**

- Fresh installation from a clean site.
- JSM issue context panel renders in the new issue view.
- Real Jira issue retrieval.
- One external MCP tool call per included core tool, from a real MCP client.
- Permission checks across two real users.
- `tests/integration/revoked-access.test.ts` executed against a real Jira source.
- `tests/integration/verifier-rejection.test.ts` executed end to end.

**Required only if Confluence is included:**

- Real Confluence page retrieval from the installed app.
- Real Confluence permission revocation.
- Real Confluence delete/trash/restore lifecycle.

**Required only if Teamwork Graph is included:**

- One real TWG relationship resolved with the triggering user's identity.
- Read-time TWG re-authorization against a second viewer.
- Graceful degradation when TWG is unavailable.

If Confluence or TWG is not included in the submission, the corresponding rows in this section are not release blockers, and the submission must not claim them.

## 19.9 Security tests

All eleven tests listed in §16.6 are required **for the sources the submission includes**. Test #1, #3, #5, #6, #7, and #8 apply whenever Confluence or TWG is included. When the submission is Jira-only, test #1 and #3 use a restricted Jira source; test #10 (Jira-source isolation beyond ticket access) is always required. Tests #2, #4, #9, and #11 are always required.

---

# 20. Build sequence

## Phase 1 — Forge skeleton

1. Scaffold with the current Forge CLI.
2. Add the minimal manifest for `jira:issueContext` only.
3. Create the resolver and a hello-world UI Kit panel.
4. Declare the resource and function.
5. Run `forge lint`. Fix actual CLI errors — this is the first authoritative signal about manifest correctness.
6. Deploy.
7. Verify the panel renders in the JSM new issue view.

Do not add every integration before the first successful deployment. The first deployment's only job is to prove the manifest and the panel module work.

## Phase 2 — Confluence compatibility (attempt; conditional)

1. Add `compatibility: jira required / confluence optional` to the manifest.
2. Add the minimum Confluence read scope.
3. Reinstall the app with the new compatibility declaration.
4. Read one real Confluence page from a backend function.
5. Verify the app's access behavior.

**If multi-app compatibility does not work in the current Forge environment, record it and proceed with a Jira-only installation.** The core product still ships with three of the four context sections: incidents, resolutions, affected services. The knowledge articles section is omitted. The manifest, scopes, event subscriptions, and MCP tools reflect the Jira-only scope.

The Jira-only fallback is a legitimate submission. It is not a degraded one. A submission that does not claim Confluence content, and does not implement it, is complete within its stated scope.

## Phase 3 — MCP hello-world

1. Add the `rovo:mcp` module with `get-ticket-context` only.
2. Add the corresponding `action` and `function` declarations.
3. Deploy.
4. Enable external MCP through Atlassian admin settings.
5. Connect an external MCP client.
6. Make one successful `get-ticket-context` call with a valid ticket key.
7. Verify the caller-identity mechanism — this is the riskiest verification item.

Resolve actual integration blockers. Do not invent successful results. If external MCP exposure is blocked in the target environment, record it and continue; the panel and remaining pipeline still ship, but the submission claims the panel-only scope and does not claim MCP bonus eligibility.

## Phase 4 — Jira pipeline and verifier

1. Implement domain types (§7).
2. Implement the Jira adapter.
3. Implement the fingerprint projection (§8.2).
4. Implement the queue producer and consumer (§6).
5. Implement incident retrieval and resolution retrieval.
6. Implement deterministic ranking (§9).
7. Persist a real `ContextBundle`.
8. Render the available sections in the panel from the stored bundle.
9. Implement the source-span verifier (§13.2) and test it against **Jira-sourced excerpts only** — incidents and resolutions. No AI summary is generated yet.

At the end of Phase 4, the verifier is testable against real Jira excerpts even though no summary exists. This proves the trust mechanism before summary generation. It is the P0 trust milestone.

Acceptance for Phase 4:

- `tests/integration/concurrent-build.test.ts` passes with the documented best-effort framing (§19.4).
- `tests/domain/verify.test.ts` passes against Jira-source fixtures.
- The panel renders a real bundle end to end for one ticket.

## Phase 4.5 — AI summary and rejected-claim badge

1. Implement summary generation from **currently available Jira-sourced excerpts** (incidents and resolutions). Do not wait for Confluence or TWG.
2. Require structured output (`GeneratedClaim[]`) per §13.6.
3. Wire the verifier into summary rendering.
4. Render the rejected-claim counter and inspectable rejection reasons in the panel (§17.3).
5. Once live generation works, remove the canned demo summary from step 8a and its "Demo fixture" label. No canned summary ships in the app (§13.6).
6. `tests/integration/verifier-rejection.test.ts` passes.

This is the P0 differentiator. If it slips, the submission loses its distinctive claim. Do not let Phases 5–9 delay it.

## Phase 5 — Remaining core MCP tools

1. Implement `find-related-incidents`.
2. Implement `find-similar-resolutions`.
3. Reuse the retrieval and authorization logic from Phase 4.
4. Verify each tool callable from an external MCP client.
5. Apply the same viewer-specific filtering as `get-ticket-context`.

All three core MCP tools must exist before clustering begins. The tools precede clustering because clustering is P1 and must not block the P0 MCP surface.

## Phase 5.5 — Per-installation configuration (mandatory before submission)

The four constants currently hardcoded for the Codegeist demo site must be configurable by site admins so the app works on any Atlassian site. Without this, every judge installation shows "Context is being prepared" permanently, because their site will not have `ITS` or `ITO` projects.

| Setting | Current hardcoded value | Constant |
|---|---|---|
| Projects that receive a context bundle | `ITS` | `BUNDLE_PROJECTS` in `src/pipeline/enqueue.ts` |
| Projects searched for incidents and resolutions | `ITS`, `ITO` | `SOURCE_PROJECTS` in `src/adapters/jira.ts` |
| Affected services custom field ID | `customfield_10039` | `src/adapters/jira.ts` |
| Request type custom field ID | `customfield_10010` | `src/adapters/jira.ts` |

### Implementation

1. Add a Jira admin settings page using the `jira:adminPage` module, rendered with UI Kit (`@forge/react`), with four fields corresponding to the four settings above. Do not use `@forge/ui` (deprecated UI Kit 1) or its `Config` API, which configures macros, not app-wide settings. Verify any other module name against the current Forge manifest reference and `forge lint` before using it.
2. Store the settings in Forge KVS (`@forge/kvs`, already declared via `storage:app`) under one namespaced key, written by the admin page's resolver. Do not use secret storage: these values are configuration, not credentials. Read the settings once per invocation.
3. Pre-fill the two custom field IDs by detecting them from Jira's field list by field type, because their IDs differ per site and an admin is unlikely to know them:
   - Affected services: the service-entity field type (`com.atlassian.jira.plugins.service-entity:service-entity-field-cftype`).
   - Request type: the JSM request-type field type.
   The admin can override a detected value.
4. Validate on save: every project key must exist and be visible to the app; every field ID must be an existing field. Reject the save with a specific message otherwise.
5. Inject the resolved settings into every call site that currently reads the hardcoded constants (`enqueue.ts`, `jira.ts`). Tests use explicit settings, not demo-site constants.
6. When no settings are saved, the app builds nothing. The panel shows "Outrider isn't set up for this project yet. Ask a Jira admin to configure it." instead of "Context is being prepared", so an unconfigured site never waits forever. MCP tools return the same message.
7. Configure the demo site once through the new page (bundle projects `ITS`; source projects `ITS`, `ITO`) so it behaves as before.
8. Verify on a second Atlassian site (not `one-atlas-edlg`; a second test site qualifies) that saving the settings causes the pipeline to build context using the configured project keys and detected fields.

### Acceptance

- No hardcoded project keys or field IDs remain in source; the settings page is the only place they are set.
- A fresh installation with no settings saved builds nothing and shows the "isn't set up" message in the panel and MCP tools, never a permanent "being prepared".
- After the demo site is configured through the page, it behaves exactly as before (no regression on the demo scenario).
- After an admin sets bundle projects to `SUP` and source projects to `SUP, INC`, events from project `SUP` trigger builds and retrieval searches `SUP` and `INC`; events from other projects do not trigger builds.
- On a site where the two custom fields exist, they are detected without the admin typing an ID; a detected value can be overridden.
- Saving an unknown project key or field ID is rejected with a specific message, and the previous settings stay in effect.

### Decisions made during implementation (step 9.5)

- Projects are chosen from multi-select lists of the projects the app can see (GET /rest/api/3/project/search, up to 500), not typed. Saves are still validated server-side. Typed keys remain the fallback if the list proves too slow or too long on some site.
- No server-side admin check in the save resolver. jira:adminPage is only reachable by Jira admins (platform guarantee); a re-check would need a new scope and a major version upgrade for every install. Revisit only if forge lint requires it.
- Saving does not build existing tickets. The page and README tell the admin to edit a ticket; queuing builds on save was rejected as surprising (and it would call the LLM for each ticket).
- The incident issue type stays fixed as "[System] Incident", not a fifth setting. On a site without it, JQL returns no results (verified: HTTP 200, no error), so the incident section is simply empty.
- Field detection takes the first field of each type (verified: exactly one of each on both test sites); the override is a choice among fields of that type, or "Not used". Both fields are optional.
- The find MCP tools only need settings to exist, not the ticket's project to be a bundle project, because they search live.
- The page is a jira:adminPage with useAsConfig: true, which adds Configure to Outrider's Jira row in Atlassian Administration → Site settings → Connected apps (⋯ menu; verified on the demo site; Jira's own Manage apps page now redirects there). Its address is /jira/settings/apps/configure/<appId>/<envId>. When the panel says "isn't set up", it also links to that page ("Open Outrider settings", Jira admins only), built from the product context's siteUrl and environmentId plus Outrider's own app ID. The README gives all three ways in.

Verified on development (5.3.0): the demo site showed "isn't set up" before configuration, then behaved exactly as before once set up (ITS; ITS, ITO). A second test site was set up only through the page (DEMO, OD); Affected services was detected as customfield_10048 (customfield_10039 on the demo site); an OD ticket then built context with incident OD-5 and a live summary.

## Phase 6 — Confluence indexing (conditional on Phase 2 success)

Skip this phase entirely if Phase 2 recorded a Jira-only fallback.

1. Implement separate `confluence-page` jobs and routing (§6.4).
2. Implement app-scoped page retrieval and text extraction (§10.3).
3. Implement index upsert.
4. Implement deletion and trash invalidation.
5. Implement move and restore refresh.
6. Implement permission-change invalidation.
7. Implement scheduled reconciliation (§10.8) with checkpoints.
8. Retry failed batches on the next run.
9. The panel's knowledge articles section renders real Confluence content.

If Phase 2 is skipped, the knowledge articles section is not rendered and the manifest contains no Confluence scopes or event subscriptions. The submission write-up states the reduced scope explicitly.

### Agreed plan for step 10 (decided 2026-11-21; built, see "Decisions made during implementation (step 10)" below)

Approach: **live search instead of an index.** The index (§10) exists to hold embedding vectors, and embeddings are not in scope yet. So steps 1 and 4–8 above (page jobs, delete/trash, move/restore, permission-change invalidation, hourly reconciliation) are not built. The build job runs one CQL search in the configured spaces as the app, then scores the results like incidents and resolutions. Deleted or restricted pages are simply not found at build time, and stored references are dropped by the read-time check. If embeddings arrive (Phase 8), an index can be added then.

Also agreed:

1. A fifth site setting on the admin page: "Confluence spaces to search" (multi-select of spaces the app can see). None chosen means the knowledge section shows "No items".
2. Matching and ranking: the same keyword matching and §9 formula as incidents and resolutions. Each Article stores an excerpt and a kind (runbook from the label, otherwise guide). At most 5 shown.
3. Read-time authorization: articles re-checked as the viewer with one Confluence search for the stored page IDs (mirroring the one JQL search for Jira). Hidden pages vanish without a trace; a failed check marks the response partial with auth:confluence-check-failed. Applies to the panel and get-ticket-context.
4. The summary may cite runbooks: articles become prompt sources, and the verifier fetches the page's current text as the viewer. This is a separate code path from liveSourceTexts (Jira) and depends on unknown 2 below; confirm it before writing the verifier integration.
5. README data notice updated: runbook excerpts are sent to Amazon Bedrock.
6. Panel: a "Knowledge articles" section.
7. Live security test: restrict the seeded VPN runbook (page 4292631, ITO space) to user A only; user B must see neither the article nor any claim citing it. Remove the restriction afterwards.

Unknowns, settled in this order before writing the adapter:

1. Read-only checks with the .env credentials (users A and B): CQL search quality for ticket text in the ITO space; whether a CQL id search hides restricted pages from a viewer without an error (as JQL does); page body format for text extraction.
2. forge lint with the search call in place: whether /wiki/rest/api/search needs a new scope (for example search:confluence). A new scope means a major version upgrade and re-consent on every install.
3. Only if 2 passes without re-consent: whether a Jira panel resolver can call Confluence as the viewer (asUser().requestConfluence) on the same site. Load-bearing for items 3 and 4.


### Decisions made during implementation (step 10)

Committed as 0bcee08 (development 6.4.0). These replace items 2, 3 and 7 of the plan above where they differ.

1. **Hybrid search, as the app.** One CQL search in the configured spaces for the ticket's 8 strongest keywords (up to 25 pages), then one batch body fetch. If CQL returns nothing or fails, the most recently modified pages in those spaces are listed instead; the build log records which path ran. Measured on the demo site: the app sees only spaces it is a member of, and CQL lagged about 13 minutes behind a membership change, which is what the fallback covers.
2. **Read-time check: one batch page fetch as the viewer** (GET /wiki/api/v2/pages?id=...), not a CQL id search. Verified: CQL as an agent with knowledge-base access returns HTTP 403 for every search, while the batch fetch returns HTTP 200 and silently leaves out pages the viewer cannot see. The same response gives each page's current text to the verifier. A failed fetch drops every article and every claim citing a page, with auth:confluence-check-failed.
3. **Scopes:** search:confluence and read:page:confluence (major version 6; both demo-site installs upgraded).
4. **Matching: rarity-weighted keyword overlap**, not the plain overlap used for Jira. Each keyword weighs its summary weight times ln((N+1)/(df+0.5)) over that build's candidate pages. A page is kept at score >= 0.2 and >= 60% of the best page's score. Measured on 13 recorded ITO pages: plain overlap kept four unrelated runbooks for the login ticket through "log" and "page"; a 40% floor still kept them at 42% and 55% on shortened and summary-only text. With 0.6, ITS-6265 keeps only the Auth runbook in every variant. Rejected: a minimum of 3 matched keywords (drops the VPN runbook for the VPN ticket), an absolute 0.4 cutoff, and a domain stopword list (held as a possible follow-up).
5. **Known limit, left to embeddings:** for the VPN ticket ITS-6267 the Auth and Database runbooks score 86% of the VPN runbook through "connect"/"connection" and are kept.
6. **Live security test:** the space-permission scenario (user B cannot see the ITO space) instead of restricting a page. Page restrictions and revoked page access are covered by integration tests; no site permissions were changed.
7. **Panel:** incidents, resolutions, articles (and later teams) each have a Show less / Show more toggle, expanded by default; the Summary keeps its own controls.

## Phase 7 — Teamwork Graph (attempt; bonus-track)

This phase is the bonus-track milestone. It is not required for a complete core submission.

1. Implement the user-context graph adapter (§11.2).
2. Resolve one real service relationship using the triggering user's identity.
3. Implement `ServiceLink` persistence with `resolvedForAccountId` (§11.6).
4. Implement read-time TWG re-authorization with a wall-clock budget (§11.6).
5. Verify actor identity and impersonation against real events.
6. Verify the graph permissions.
7. Degrade cleanly when TWG is unavailable (`twg:no-actor`, `twg:viewer-not-authorized`).

**If TWG is unavailable in the target environment, record it and proceed without it.** The affected services section is not rendered. The manifest omits TWG scopes and the `requestTeamworkGraph` path. The submission does not claim the Teamwork Graph bonus track.

At the end of a successful Phase 7, one real TWG relationship appears in the panel and is re-authorized per viewer. This is the bonus-track milestone. If Phase 7 is skipped, the submission claims the core scope only.

### Decisions made during implementation (step 11, 2026-11-22)

Built as step 11 (development 8.3.0). These replace items 2–5 above and the stored ServiceLink of §11.6.

1. **Read time only, as the viewer: the §11.6 alternative, chosen as a spec change.** Nothing from Teamwork Graph is stored, so there is no ServiceLink, no resolvedForAccountId and nothing to re-authorize; every read is a fresh lookup as the current viewer. Probed on the demo site: Forge apps can call Teamwork Graph only as a user, and the queue consumer cannot call it at all (asUser(): HTTP 401 AUTH_TYPE_UNAVAILABLE; asUser(actor accountId): HTTP 401 NO_IMPERSONATION_SCOPES_DEFINED). The panel resolver and the MCP action can (HTTP 200). The build-time path of items 2–5 is therefore not possible, so twg:no-actor does not arise.
2. **The relationship: team linked to the Jira space (project) of a related incident,** through the curated query atlassianTeamsBySpace. New apps cannot send raw Cypher; curated queries need no registration. The Teamwork Graph schema on this site has 36 query fields; none covers JSM services or Assets, so "affected service" (§11.1) is not used.
3. **Rejected: incident assignee → teams** (atlassianUserInTeams). Every demo-site assignee with teams is in 9 to 18 of them, so it could not say which team is involved. No demo-site incident has the Jira Team field (customfield_10001) set either.
4. **Site setup:** no team was linked to any space on the demo site. With the user's approval, Platform Support was linked to the ITO project in Atlassian Teams (a site setting, not app data). atlassianTeamsBySpace returned it about a minute later. On a site with no linked team the section says so: "No teams linked to this project's space. Link a team to the project in Atlassian Teams to see it here."
5. **What is looked up:** the distinct projects of the related incidents the viewer can see, among the five shown (at most 5 projects), in parallel within a 4-second wall-clock budget. Teams deduplicated, at most 5, each with evidence ("Linked to the ITO project, where ITO-9647 is tracked") and its profile link. A viewer who sees no related incident causes no call.
6. **Failure:** any failed or timed-out lookup drops all teams for that read, marks the response partial with twg:unavailable (replacing twg:viewer-not-authorized, which assumed stored links) and leaves every other section unchanged.
7. **Panel and MCP:** a "Teams involved" section after the incidents; get-ticket-context returns teams plus a teamsNote. Verified via Rovo: with no note the agent wrote "Platform Support is currently investigating"; with a first note, "Responsible Team"; with the final note ("not as the responsible, owning or investigating team"), "Linked Team: Platform Support (linked to the ITO project where the incident is tracked)". The find tools do not return teams.
8. **Scopes:** read:graph:project:jira and read:graph:team:atlassian. read:graph:issue:jira was added for the probe and removed (major version 8). A missing or declined graph scope returns an empty result, not an error.
9. **Ranking unchanged:** relationship strength (§9.2) stays 0; teams are a separate section, not a ranking input.
10. **Verified with two users on the demo site:** user A sees Platform Support in the panel and via Rovo; user B (no ITO access) sees "No related incidents to look up teams for."

## Phase 8 — Embeddings

1. Confirm tenant data-handling approval for the target environment (§12.3).
2. If approved, add the embedding provider and egress declaration.
3. Store embeddings on index records.
4. Wire `semanticSimilarity` into ranking.
5. If approval is not available, skip this phase. The core product works without embeddings.

Embeddings are a booster, not a dependency. Skipping Phase 8 is an acceptable outcome.

### Decisions made during implementation (step 12, 2026-11-22)

Built as step 12 (development 9.1.0). These settle §12.2 (provider) and replace §12.4 (index refresh) and part of §12.1 (failure value).

1. **Provider: Jina AI, `jina-embeddings-v5-text-small`, 1024 dimensions, hosted API.** The maintainer's constraint was no card and no new payment; §12.3 requires no training on submitted content. Checked against each provider's own pages:
   - Mantle: no embedding model for the key (61 chat models only).
   - Bedrock runtime: blocked for the account ("Operation not allowed").
   - Voyage: trains unless you opt out, and the opt-out needs a card.
   - Gemini: the free tier is used for training.
   - OpenAI: $5 card prepay, no free credit.
   - Cohere: trial keys are not allowed in production and are capped at 1,000 calls a month.
   - Nomic: the individual terms allow improving its technology.
   - Hugging Face: no free credits for free users.
   - Together, Nebius: payment required. NVIDIA: prototyping only. SambaNova: no embedding model.
   - Jina, from its FAQ and self-check: a free key with 10M tokens and no card; "We never use your API requests, inputs, or outputs to train… any other models"; commercial API use is covered by its service terms. The free tokens are one-time.
2. **Rejected, self-hosted MiniLM:** inside Forge it needs manual packaging for every function (Preview); on AWS Lambda it needs a separate service to run. At 600-character inputs it also ranked the 404 postmortem above the Auth runbook for the login ticket.
3. **No index, so no §12.4 refresh.** Builds already retrieve live; one batched pair of calls per build (ticket as `retrieval.query`, candidates as `retrieval.passage`) embeds the ticket and its keyword-chosen candidates, each title plus stored excerpt cut to 600 characters and minimized as in the summary prompt. No vector cache: about 400–800 tokens per build on the demo site.
4. **Hybrid ranking.**
   - Keywords still choose the candidates; embedding cosine (through `normalizeCosine`) becomes `semanticSimilarity`, and every section is re-ranked with the §9 formula.
   - Incidents and articles are kept only at ≥ 60% of the best cosine in their section. Resolutions are only re-ordered.
   - Measured on recorded demo-site vectors: the VPN ticket's Auth and Database runbooks (42–55%) and the database incident ITO-9648 (42–47%) are dropped.
   - Embeddings alone would keep the login ticket's 404 postmortem (89%), so the keyword gate stays.
   - The incident floor was added after the live check still showed ITO-9648.
5. **1024 dimensions, not 256:** at 256 and 512 the VPN ticket's Database runbook stayed above the floor (68%, 63%); at 1024 it is 55%.
6. **Failure value:** on any embedding failure (no key, timeout, HTTP error, malformed output, no tokens left), ranking keeps the keyword overlap instead of `semanticSimilarity = 0`, so it is never worse than before. Logged only (§12.5); not shown in the panel or MCP and not a bundle failure.
7. **Find tools stay on keywords** (live per call; an extra provider call per Rovo question was not worth it).
8. **Verified on the demo site (development 9.1.0):** ITS-6267 shows only the VPN runbook and ITO-9649 (log: `below the floor: 2 article(s), 1 incident(s)`, 784 tokens, 260 ms); ITS-6265 shows the Auth runbook and ITO-9647.
9. **Data handling (§12.3):** approved by the maintainer for the demo site; production uses the same key and the README data notice names Jina. `JINA_API_KEY` is set in development; production still needs it, with `MANTLE_API_KEY`.

## Phase 9 — Clustering (conditional, P1)

Only if clustering is included in the submission.

1. Implement canonical identity resolution using only the sources listed in §14.2.
2. Implement window and threshold configuration (§14.5).
3. Implement signal lifecycle with idempotency and deduplication (§14.6–§14.8).
4. Implement the cluster storage key encoding (§18.7) with round-trip tests.
5. Implement evidence pack with explicit evidence IDs (§14.11).
6. Implement read-time permission filtering for signals (§14.9).
7. Add `get-emerging-incidents` MCP tool and action.
8. Render the emerging signal in the panel (§17.4).
9. All §19.3 clustering tests pass.

If clustering slips, remove Phase 9 as one unit: cluster.ts, clusterPass.ts, the scheduled clustering trigger and handler, get-emerging-incidents, and the emerging-signal panel UI are all omitted. No stubs remain. The core product still ships.

### Decisions made during implementation (step 13, 2026-11-23)

Built as step 13 (development 9.2.0 to 9.9.0, including the fixes from live testing below). Clustering is included in the submission.

1. **Identity sources (§14.2): Affected services for the service, Components only for the entity.**
   - On the demo site, Affected services values are `[{ id: "ari:cloud:graph::service/<site>/<service>" }]`, with names only via `expand=renderedFields`. Components values are `[{ id: "10014", name: "VPN Server" }]`.
   - Assets object fields came back `[]` for the demo user, so an Assets choice could not be shown to work. Without a visible error, the admin would see a demo that silently never clusters. The settings page refuses any field other than Components: "Entity field for clustering: only Components is supported."
   - Free text never contributes: two requests sharing only words give no signal (§14.3).
2. **One site-wide window and threshold (§14.5):** default 90 minutes and 5 requests; allowed 15–10080 minutes and 2–50 requests. A signal keeps the values it was raised with.
3. **When passes run:** a `cluster-pass` job is queued 20 seconds after any ticket event in a project that gets context, and an hourly `cluster-sweep` scheduled trigger queues one per project. A per-project lock (`cluster-pass_<KEY>`) runs one pass at a time; a pass that finds it held is deferred and re-queued. A pass reads at most 200 open requests.
4. **Uncertain beside confirmed:** a new uncertain signal does not form for a service or component already covered by an active (or dismissed, unexpired) confirmed signal. An existing uncertain signal is not removed when a confirmed one forms later; it stays uncertain until its window ends (§14.3, idempotency). Seen live: an uncertain Infrastructure Services signal (7 requests) stayed next to the new confirmed VPN Server signal (5).
5. **Dismiss (§14.7 resolved by a human):** moves the record to resolved for everyone; it is not raised again within its window. Only a viewer who can see the ticket and enough of the signal's requests may dismiss it. Nothing is written to Jira.
6. **Read time (§14.9):** one JQL search as the viewer per read for all requests in the signals. A signal is shown only if the viewer sees at least its threshold of requests, and only with those. A failed check shows nothing (`auth:cluster-check-failed`).
   - Added after live testing: a signal whose window has ended is hidden at read time even before a pass marks it expired. The live check showed a signal still shown 22 minutes after its end time, until the hourly sweep.
7. **Storage key (§18.7):** Forge KVS keys must match `^(?!\s+$)[a-zA-Z0-9:._\s-#]+$` and be at most 500 characters, so the `%XX` escapes in §18.7's examples are rejected ("Field 'key' must match pattern"; found on the first live pass). Segments now escape as `_XX`, with `_` itself always escaped, so decoding stays exact; a unit test checks real ARIs and timestamps against the KVS pattern. Records are deleted 7 days after their window ends.
8. **Agent wording (§14.10):** `get-emerging-incidents` returns `signalsNote`. Verified via Rovo: with the first note the agent wrote "no formal incident has been declared yet" and read "confirmed" as "a high likelihood of a shared issue"; the note now says "confirmed" only means both fields match, neither state says how likely an incident is, and not to say "yet".
9. **Panel text:** the uncertain reason says "at least one does not name a component" (or "an affected service"); the first wording, "none names a component", was wrong when some requests did.
10. **Repeated summary claims (generation, found while testing clustering):** five requests with one shared description produced the same claim four times. `parseGeneratedClaims` now drops a claim worded the same as an earlier one, ignoring case and punctuation.
11. **Demo data:** cluster requests are created by the seed pack shortly before recording, never kept on the site, because a signal lasts one window. Other open requests on the same service count too (the re-seeded SR-2 and SR-3 carry Infrastructure Services with no component), so they are seeded more than one window earlier. The demo site's SLA clean-up automation, which closed ITS-6265, ITS-6266 and ITS-6267, was disabled; SR-1 to SR-3 are now ITS-6273 to ITS-6275.
12. **Verified live on the demo site:**
    - 4 requests on one service gave no signal.
    - The 5th gave an uncertain signal; 5 with service and component gave a confirmed one.
    - A 6th joined both signals.
    - 3 component-only requests gave an uncertain signal at threshold 3.
    - Dismiss cleared a card everywhere, including Rovo.
    - Thresholds 1 and 51 were refused.
    - A 15-minute signal disappeared at its end time before the hourly sweep (development 9.4.0).
13. **Forge token outage on the demo site (2026-11-23, development 9.4.0 to 9.6.0).** From 13:55 UTC Teamwork Graph lookups failed. At 14:44 UTC the hourly sweep's queue push failed with `PROXY_ERR … 500 - UNAVAILABLE_TOKEN_ERROR`; it runs as the app, and this was 15 minutes before any deploy that afternoon. From 15:02 UTC every viewer check failed with `NEEDS_AUTHENTICATION_ERR` (401, `atlassian-token-service-key`). From about 15:21 UTC app calls failed with 401: Jira GET, Confluence and queue push. Jina and Bedrock kept working. `forge install --upgrade` was a no-op ("already at the latest version"), and the developer status page showed everything operational. It cleared without any change. Nothing in the code that makes these calls changed between failing and working, so the cause is treated as on Atlassian's side; it is not proven.
14. **Consent prompt (§16.5 refined).** The panel caught `NEEDS_AUTHENTICATION_ERR` like any failed check and showed "not available", so Forge never offered "Allow access" and the viewer could not recover. The panel now lets that one error, identified by its `name`, leave the resolver; every other failure still fails closed. The MCP tools are unchanged, because how Rovo handles that error was not checked.
15. **Teams per project (§11.5 refined; replaces step 11's all-or-nothing).**
    - Teamwork Graph intermittently refuses valid reads on this demo site: HTTP 200 with "User is not permitted to query this organization (ValidationError)" and a non-null error at `graphStore/cypherQueryV2`. This matches community.developer.atlassian.com/t/103690, where about 30% of reads on a Forge demo site succeeded and another site answered every read.
    - Each project is now looked up on its own. Teams from projects that answered are shown; failed projects add `twg:partial`, with the panel note "Some teams couldn't be checked right now.", and if all failed, `twg:unavailable` as before. A project that could not be checked is never shown as having no team.
    - Only that refusal is retried: 5 tries about 300 ms apart, no new try once its pause would end after the 4-second budget.
    - Measured: with 3 back-to-back tries, ITS-6275 (incidents in ITS and ITO) needed 7 refreshes to show Platform Support. With spaced tries and per-project results, 5 of 5 refreshes on ITS-6275 and 5 of 5 on ITS-6273 showed it.
    - A per-viewer, per-project cache used only on failure was considered and deferred: it would reverse "teams are never stored" for one site's problem. It is the next step if the rehearsal is still flaky.
16. **Smaller fixes from the same testing:**
    - Lock acquire: a conflict whose lock was already released by the re-read is retried once instead of logged as a storage error ("Provided key already exists and cannot be overwritten").
    - Teamwork Graph errors: the log now carries the first two GraphQL messages and their classification, cut to 200 characters.
17. **Not done:** Assets as an entity field. Hiding a signal from a viewer who cannot see enough of its requests is covered by the integration tests only; on the demo site both users can see every ITS request, so the second user correctly saw the signal too.

### Decisions made during implementation (step 14, production and judge rehearsal, 2026-11-24)

Production deployed (3.0.0 was a major version for the Bedrock and Jina egress; 3.3.0 at the end of the rehearsal), with `MANTLE_API_KEY` and `JINA_API_KEY` set encrypted in production. Rehearsed as a judge would: the README's install link on a second test site (after uninstalling an old development install there), then the README's setup steps.

1. **What passed as documented:** the install screen listed both egress domains; the panel said "isn't set up" with the settings link; the fields were detected (`customfield_10048`, `customfield_10010`); the green save message; the first build gave a 3-claim summary from OD-5 (Jina 121 tokens, Qwen3-235B in 1.9 s); Teams said "No teams linked"; a clustering pass ran for `OD`.
2. **Confluence spaces were never listed (fixed).** The settings page asked for `type=global` spaces only. The second site had none: `SD` is type onboarding and `IKB` collaboration, both open to All Confluence users, so the list was empty even with Outrider added to `SD`. It now lists every current space except personal ones. Choosing and searching a space never depended on its type. The README's claim that only member spaces are visible was also wrong: open spaces are visible without adding Outrider; restricted ones need it, and two Outrider entries appear, one per installed product.
3. **The right runbook was dropped for a long description (fixed).** OD-2 against IKB's three runbooks: CQL found 3 candidates, 0 kept. 10 of OD-2's 20 keywords appear in no page, and in the rarity-weighted score such a word had the highest weight while telling no page apart, so the Auth runbook scored 0.183, under `MIN_ARTICLE_SCORE` 0.2. Keywords no candidate contains are now left out of the denominator: Auth runbook 0.680, the Database and VPN runbooks 0.257 and 0.253, below 60% of the best. Every demo-site expectation (VPN, login, summary-only) is unchanged; a fixture recorded from the second site pins the new case. Live after the fix: OD-2 showed the Auth Service Troubleshooting Runbook.
4. **No stored account IDs.** `actor.accountId` (the editing user or the Rovo caller) was written into queued jobs and build status and never read. Atlassian's user privacy guide requires reporting stored account IDs through the Personal data reporting API, and recommends not storing them; it is no longer stored. The developer console's declaration is still "Yes": stored excerpts are cached for longer than 24 hours and can contain names typed into tickets. `TERMS.md` states what is stored, for how long, and how to remove it (Forge keeps hosted storage 28 days after uninstalling).
5. **Not rehearsed:** the Rovo tools, because the second site has no Rovo; they are checked against production on the demo site, where the development install is replaced by production before recording.

Phase 10 — Demo

Build one reproducible scenario. Rehearse at least five times. Target under three minutes for the core walkthrough.

Demo readiness requires all of the following, each conditional on the corresponding integration shipping:

· Act 1 end to end from a clean installation.
· The rejected-claim drop visible on camera from a live build. Model output varies between builds, so rebuilding (Refresh) until a build contains a rejection is allowed; the narration says that output varies and that the rejection shown is the model's own. Nothing may be changed to provoke one (§13.6).
· At least one MCP tool call from a real client. (skip if Phase 3 recorded an MCP block; the submission claims panel-only scope)
· One Teamwork Graph relationship in the panel. (skip if Phase 7 is skipped; the submission does not claim the TWG bonus)
· Fallback recordings for whichever of MCP or TWG is included, in case either flakes live.

If Confluence was skipped in Phase 6, Act 1 shows three sections (incidents, resolutions, services) or, if TWG was also skipped, two sections (incidents, resolutions). The demo narration states the scope explicitly. The demo does not imply sections that are not present.

---

21. Demo narrative

Act 1 — always

1. A support ticket arrives in JSM.
2. Outrider assembles relevant context asynchronously.
3. The JSM agent opens the ticket.
4. The panel already contains the sections the submission includes:
   · An active incident. (always)
   · A past resolution. (always)
   · A relevant Confluence runbook. (only if Phase 6 shipped)
   · A service relationship. (only if Phase 7 shipped — see Act 2A)
5. The agent opens a source reference to the incident.
6. The agent expands a source-matched claim in the summary. The span and the exact source text are shown.
7. The rejected-claim counter shows a dropped claim from the live build. The agent clicks see why and sees the claim struck through with "Removed: couldn't match this to the source's wording". The claim itself is visible in the rejection list — because the cited source is authorized for this viewer. The narration says why: Outrider only shows claims it can match to the cited source's wording; this one could not be matched, so it was removed. If the rejected claim is a reworded true fact, say so rather than calling it a hallucination.
8. An external MCP client calls get-ticket-context and receives the same bundle, viewer-filtered. (skip if Phase 3 recorded an MCP block)

Act 1 is the P0 story. It must work from a clean install with no demo-specific shortcuts: no canned summary, nothing hardcoded for the demo ticket. Act 1 does not depend on TWG.

Act 2A — Teamwork Graph moment (only if Phase 7 shipped)

This is the bonus-track segment. It is separate from Act 1 so that Act 1 remains shippable without TWG.

9. In the same ticket's panel, scroll to the affected services section.
10. Open the service relationship to the owning team's page.
11. If a fallback recording is used because live TWG risk is high, state that clearly in the narration.

If Phase 7 was skipped, this segment is omitted and Act 1 does not reference the affected services section.

Act 2B — clustering (only if Phase 9 shipped)

12. Additional requests arrive in the queue. They share a confirmed service ID and a structured entity with the first ticket.
13. Outrider raises an emerging-incident signal with the evidence pack.
14. The agent sees the signal card above the sections. The signal state (confirmed) and the matching requests are visible.
15. An MCP client calls get-emerging-incidents and receives the same signal, viewer-filtered.

Act 2B is additive. If it is cut, the demo is still coherent.

Comparison with native JSM features (checked on the demo site, ITS-6265, 2026-11-21)

Checked by looking at JSM's own features on the same ticket the demo uses, on one-atlas-edlg with AI features on.

| | JSM native, on ITS-6265 | Outrider, on ITS-6265 |
|---|---|---|
| Summary | AI summary at the top of the ticket ("Summary", footer "Uses AI. Verify results."): restates this ticket only, the generic login error and an SLA warning from Automation for Jira | Links the ticket to the active outage ITO-9647 and the SSL fix from ITO-9642; every claim shows its source text; a claim that could not be matched is removed and listed |
| Related incidents and past fixes | None: the ticket shows no Similar requests section | ITO-9647 (active, Strong match) and ITO-9642 with the fix text from its resolution comment |
| Related articles | Details > Knowledge base > View related articles: ten pages from the IT Support knowledge base (Cisco AnyConnect VPN, Mac VPN setup, Gmail, Zoom, generic how-to pages); none about the login outage. The Auth Service runbook lives in the ITO space, which JSM does not search | Step 10 (not built at the time of checking): searches the Confluence spaces the admin chooses, so the Auth runbook in ITO can be found |
| For AI agents | Rovo searches and summarises by itself | The same checked, per-viewer context over MCP (three tools, verified with two users) |

Safe to say in the narration:

· "On the same ticket, JSM's summary restates what the requester wrote. Outrider links it to the active login outage and to how the last one was fixed, and shows the exact source text for every claim."
· "Claims Outrider cannot match to their source are removed and shown, not hidden."
· "The same checked context is available to Rovo agents through MCP."

Do not claim:

· That JSM can never find related incidents. This was one ticket on one site; other sites or ticket types may show Similar requests.
· That JSM cannot find articles. The runbook was simply not in the knowledge base JSM searches.
· Anything about Outrider's articles until step 10 is built and verified on the demo site.
· That "proactive" is the difference: JSM's native panels are proactive too. Lead with verification and cross-project incident and fix context.

Re-check this table before recording the video; native features change.

Demo discipline

· The summary is generated live by the LLM and verified live. State this in the narration. Its wording differs between builds; the source sections do not depend on the LLM.
· The product's value must not depend on one particular LLM response. If generation fails, the panel shows the source sections without a summary (§13.3), and the demo still works.
· Any rejection shown is the model's own output. Never change a prompt, ticket or source to provoke one (§13.6).
· If TWG flake risk is high on the day, use a pre-recorded segment for Act 2A and state clearly that the recording is used.
· Do not claim a live integration succeeded if it did not. If a segment is pre-recorded, say so.
· The demo's scope matches the submission's scope. A Jira-only submission does not show a knowledge articles section or a service relationship. A submission without TWG does not claim the Teamwork Graph bonus track. The narration states the scope.

---

22. Cut order

If time is constrained, cut in this order. Each cut removes one entire capability, not a partial one.

1. Configuration UI.
2. Cosmetic UI refinements other than the rejected-claim counter and see why list.
3. Broader Teamwork Graph coverage; retain one real relationship if Phase 7 shipped, or ship without TWG entirely.
4. Scheduled reindex breadth (reduce to a slower interval or manual trigger).
5. Embedding enhancements.
6. Clustering module and get-emerging-incidents (drop as one unit; do not ship a half-built cluster display).

Never cut:

· JSM issue context panel.
· Incident and resolution retrieval.
· ContextBundle as the shared persisted type.
· Read-time authorization, including filter-at-retrieval.
· Source-span verifier and rejected-claim counter badge.
· Live LLM summary generation (§12.6, §13.6).
· All three core MCP tools if MCP is claimed; if MCP is blocked in the environment, the submission claims panel-only scope and the tools are omitted together.
· Concurrency, revoked-access, and verifier-rejection tests.
· Reproducible fresh installation and demo.

Conditional items — cut only as a complete unit, never as a partial feature:

· Confluence knowledge retrieval. If Phase 2 records a Jira-only fallback, cut the knowledge articles section, Confluence event triggers, and Confluence scopes together. Do not ship a knowledge articles section backed by nothing.
· Teamwork Graph. If Phase 7 is skipped, cut the affected services section and TWG scopes together. Do not ship an affected services section backed by nothing, and do not simulate a live graph result and claim it is real.
· Clustering. If Phase 9 is skipped, cut the emerging signal, get-emerging-incidents, and the clustering scheduled trigger together.

If TWG access is unavailable, preserve the core product and report the limitation. If Confluence is unavailable, preserve the core product and report the reduced scope. The submission never claims an integration it did not deliver.

---

23. Definition of done

Outrider is complete when the following are true for the scope the submission actually ships. Items marked conditional are required only if the corresponding integration was delivered.

Core engine

☐ Forge app installs successfully from a clean site.
☐ JSM issue context panel renders in the new issue view.
☐ Jira issue events enqueue jobs.
☐ Queue consumer builds a ContextBundle.
☐ Incident retrieval works against real Jira data.
☐ Resolution retrieval works against real Jira data.
☐ Panel displays the incidents and resolutions sections.
☐ Every displayed item has a source reference and freshness.
☐ Partial source failure preserves successful sections.
☐ (conditional) Confluence articles are retrieved and served with per-viewer authorization — only if Phase 6 shipped.
☐ (conditional) One Teamwork Graph relationship is demonstrated end to end, including read-time re-authorization — only if Phase 7 shipped; this is the bonus-track criterion, not a core-engine criterion.

Trust

☐ Source-span matching works and has domain tests.
☐ At least one claim in the demo is dropped by the verifier, and the drop is visible in the panel.
☐ Rejection reasons are inspectable and report no-matching-span.
☐ Claims whose cited source is unauthorized are omitted entirely, with no disclosure of their existence.
☐ Claims whose cited source is null or unresolvable are omitted entirely.
☐ The authorization-first ordering is tested in tests/domain/verify.test.ts.

MCP (conditional — only if Phase 3 succeeded)

☐ get-ticket-context works externally and enforces the authorization gate before any side effect.
☐ find-related-incidents works externally and returns Incident[] filtered per viewer.
☐ find-similar-resolutions works externally and returns Resolution[] filtered per viewer.
☐ All three tools enforce the same authorization rules as the panel.
☐ The caller's identity is verified against the actual Rovo MCP invocation mechanism.

If MCP is blocked in the environment, the submission claims panel-only scope and does not claim the MCP bonus track.

Security and concurrency

☐ Panel authorization is enforced.
☐ (conditional) Confluence source permissions are enforced — only if Phase 6 shipped.
☐ Jira-source isolation beyond ticket access is enforced.
☐ Duplicate queue delivery is safe.
☐ Concurrent builds are handled in the tested interleaving, with the documented best-effort framing (§19.4).
☐ tests/integration/concurrent-build.test.ts passes.
☐ tests/integration/revoked-access.test.ts passes against the sources the submission includes.
☐ tests/integration/verifier-rejection.test.ts passes.
☐ All security tests in §16.6 that apply to the shipped scope pass.
☐ (conditional) Confluence deletion and permission changes invalidate stale indexed content — only if Phase 6 shipped.
☐ Reconciliation repairs orphaned statuses, expired locks, stuck statuses, and stale bundles.

Submission

☐ Fresh installation and setup instructions work from a clean site.
☐ Submission write-up maps one section to each judging criterion.
☐ Submission write-up states the shipped scope accurately. No bonus track claimed that was not delivered.
☐ Bonus track declaration is present only if the corresponding integration shipped.
☐ Demo is reproducible and under three minutes.
☐ Demo narration states the shipped scope and identifies any pre-recorded segments.
☐ No third-party trademarks or stock images appear in the submission.

If clustering is included

☐ emergingIncident appears on the bundle when a signal is active.
☐ get-emerging-incidents works externally with the same authorization rules as the panel.
☐ All §19.3 clustering tests pass.
☐ Cluster storage keys round-trip through encodeClusterKey / decodeClusterKey.

---

24. Unresolved verification items

Do not silently assume these are settled. Each is confirmed through CLI, package declarations, real deployment, or an explicit integration test.

Item Required verification
Node.js runtime declaration forge lint and deployment
Multi-app compatibility Manifest validation and installation on a site with and without Confluence. If this fails, the submission ships as Jira-only per §20 Phase 2.
Queue export and contract Installed @forge/events type definitions and a minimal queue job executed end to end
Forge function timeout configuration Validate the supported manifest setting against the installed CLI
Confluence event identifiers Trigger real page create/update/delete/trash/restore/move events and inspect invocation — only if Confluence is included
Confluence event scope requirements Verify scopes per event against the Forge event catalogue — only if Confluence is included
Jira event actor identity Inspect real event and context payloads
TWG user impersonation Validate scopes and execute one real user-context query — only if TWG is included
MCP invocation identity Inspect the actual action invocation context from a real external caller — only if MCP is claimed
MCP authorization Two-user integration test — only if MCP is claimed
KVS concurrency semantics Verify actual API guarantees before relying on any atomicity beyond best-effort
UI Kit refresh mechanism Test the proposed polling behavior in the deployed issue context
Confluence permission changes Restricted-page integration test — only if Confluence is included
Confluence deletion lifecycle Real deletion/trash/restore test — only if Confluence is included
LLM provider egress and secret storage (Bedrock via Mantle, §12.6) Configure and execute one real generation call from the Forge sandbox; confirm available models and structured-output support
Embedding provider data handling Tenant approval documented per environment before Phase 8
write:confluence-content necessity Add only if the CLI rejects the manifest without it for the declared events — only if Confluence is included

The CLI, installed package declarations, and real deployment are authoritative for implementation compatibility.

Do not turn unresolved items into assumptions. Do not describe a feature as verified when the corresponding row in this table remains open.

---

25. Final implementation instruction

Start by inspecting the repository and the installed Forge tooling.

If no repository exists, scaffold it using the current Forge CLI.

Do not generate the entire application in one pass.

First produce the minimal Jira issue context panel and deploy it. Confirm the panel renders. Then implement each phase in sequence (§20).

For every integration:

1. Implement the smallest real working path.
2. Compile.
3. Run forge lint and fix actual CLI errors.
4. Test with fixtures at the domain layer.
5. Deploy when the integration boundary requires it.
6. Record actual results — not expected results.
7. Continue only when the recorded result matches the acceptance criterion.

A feature is complete when its acceptance test exists and passes. Not when its handler returns without throwing. Not when its type compiles. Not when its resolver shows a mock response.

The tests in §19.4, §19.5, and §19.6 are release blockers for the scope the submission ships. A submission that fails any of them, for a scope it claims, is not Outrider.

Scope is honest. A submission that ships the Jira-only core, with the verifier and rejected-claim badge, is Outrider. A submission that ships the full scope with Confluence, TWG, and MCP is Outrider. A submission that claims an integration it did not deliver is not.

Build Outrider. Do not redesign Outrider.
