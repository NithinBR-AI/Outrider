# Outrider

> Sent ahead. Context in place.

An evidence-gated context engine for Jira Service Management. Outrider surfaces relevant incident history, past resolutions, and runbook knowledge directly in the JSM issue panel — before the agent asks.

Built on Atlassian Forge for Codegeist 2026.

## What it does

- Adds an **Outrider** panel to every JSM issue showing source-grounded context
- Retrieves related incidents and past resolutions from Jira
- Retrieves relevant runbook and KB articles from Confluence
- Gates every AI-generated summary claim against a verbatim source span — unsupported claims are dropped and counted
- Exposes the same context bundle via Rovo MCP tools for AI agents

## Build status

| Step | Description | Status |
|------|-------------|--------|
| 1 | Scaffold with `forge create` | ✅ |
| 2 | Minimal Forge manifest + UI Kit panel | ✅ |
| 3 | `forge lint`, deploy, verify panel in JSM | ✅ |
| 4 | TypeScript conversion + Confluence API verification | ✅ |
| 5 | Rovo MCP hello-world + `get-ticket-context` | ✅ |
| 6a | Jira event → queue → consumer → stored bundle → panel (incidents, resolutions) | ✅ (development) |
| 6b | Deterministic ranking, ticket fingerprint, stale-build supersession, candidate limits, relevance indicator | ✅ (development) |
| 6c-1 | Per-ticket lock, write guards, concurrency test | ✅ (development) |
| 6c-2 | Read-time authorization in the panel, verified with two users on the demo site | ✅ (development) |
| 6c-3 | MCP caller identity and authorization gate for `get-ticket-context`, verified with two users via Rovo | ✅ (development) |
| 7 | Source-span verifier (tested against real demo-site text; used by the summary in step 8) | ✅ |
| 8a | Verified summary on the read path (panel and MCP), canned demo summary, verifier-rejection acceptance test | ✅ (development) |
| 8b | Summary and rejected-claim counter in the panel, with the matching source text per claim | ✅ (development) |
| 8c | Live LLM summary generation (Amazon Bedrock via Mantle), coverage rule in the verifier, canned demo summary removed | ✅ (development) |
| 9–14 | Remaining MCP tools, per-site configuration, Confluence, TWG, demo | 🔜 |

## Install

> **Judges:** You must be a site admin of the Atlassian site you install on. The app requires installation on both Jira and Confluence.

[Install Outrider](https://developer.atlassian.com/console/install/91f15c4b-555e-4db0-99e1-7567c801fc07?signature=AYABeJea9AN5%2BgVEUoMfUTwDwJMAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB3IRbHYCugUXrJrT%2B3qZRfwAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDLwSiW1oRQUP7NZshAIBEIA7XICglS%2BoVEwMrLjoUVsgMgF4U5dMn6c8jEbAwj%2BwEKfulJ0v%2Frz%2FvkLJMaedKu%2FE%2B0HmKBQ9LFiczA0AB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgGx1s%2FbJa9p1OYmxHefjQyWAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMasJ8HuRtdj33ChyCAgEQgDuKlLnDahUrzxNtd3QHq9h1oawh2EO2IeiH7K60hup4dLFQGz1DcWZ2kWZiYBcyjvFPF3wBacT%2F8XfFNQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEATjuS4HsiPRVF5%2FWjRHs6E0AAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAyYlOz80QTFCAljtRQCARCAO3BbtwjzWy4x0mNH4UxeUxkPgrhttRE0P1Zp9EwnPqCY3b%2FQvv4L9OdNtKUXtzbyjmjRIkkYwMlL9q7EAgAAAAAMAAAQAAAAAAAAAAAAAAAAAE5jtzTNDmMVPSR5GzfBZMT%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJqxdE4UiqUgSdvbgvE1DVp5PfTH0x1fTTkhvPSnKyUK%2FjKO1gCGuN5Req2C0W6AMDJSgGgVXJiPyhRkoU4%2B7LneFY%3D&product=confluence&product=jira)

## Demo site

The Codegeist provisioned demo site has Rovo Enterprise, seeded JSM data, and Confluence knowledge bases.
During development it runs the **development** environment of Outrider (the panel shows a **DEV** badge).
The install link above installs the **production** environment, which is updated before submission.

**Site:** `one-atlas-edlg.atlassian.net` (expires 2027-02-18)

### See the JSM panel

1. Go to [IT Support queue](https://one-atlas-edlg.atlassian.net/jira/servicedesk/projects/ITS/queues/custom/1)
2. Open the demo ticket **ITS-6265** ("Cannot log in - getting error on login page")
3. The **Outrider** panel in the right-side context section shows a live-generated summary (claims with their
   matching source text, and any rejected claims behind "see why"), then the related active incident and past
   resolution, each with a source link, freshness and a match label (Strong, Good or Partial)

Context is built when a ticket is created or updated, not when the panel opens. A ticket that has not changed
since Outrider was installed shows "Context is being prepared": edit any field (for example Urgency), wait a
minute or two for the Jira event, then press **Refresh** at the top of the panel. Refresh only re-reads stored context.

### Test the MCP tool via Rovo Studio

1. Open any Jira page on the demo site and click **Ask Rovo** (top-right)
2. Click the agent selector dropdown → **Create agent** → **Start from blank**
3. Click **+ Add tools** → select **outrider** from Connected apps → select **Get ticket context (development)** → **Add**
4. Click **Test** (top-right) and send: `Use the get-ticket-context tool with ticketKey ITS-6265`
5. The agent answers with the related active incident (ITO-9647), the past resolution (ITO-9642) and the
   source-matched summary claims; any claim whose wording could not be matched comes back separately as unsupported

The tool returns the same context as the panel, filtered for whoever is asking: incidents and resolutions with
source links and freshness (`builtAt`), plus the verified summary (see [Evidence-gated summary](#evidence-gated-summary)).
Internal build fields are left out. For a ticket with no context yet it
answers "being prepared" and queues a build; ask again a minute later. A ticket the caller cannot see, or one that
does not exist, gets the same "not found or no access" answer.

### View runtime logs

Go to the [Forge developer console](https://developer.atlassian.com/console/myapps/91f15c4b-555e-4db0-99e1-7567c801fc07/monitoring/logs) → Logs tab.

## Requirements

- Node.js 20+
- Forge CLI: `npm install -g @forge/cli`
- Atlassian developer account with site admin access

## Setup

> **Maintainer only** — these steps require access to the registered app. Judges: use the [install link](#install) above.

```
npm install
forge login
forge deploy -e production
forge install -p Jira -s <your-site>.atlassian.net -e production
forge install -p Confluence -s <your-site>.atlassian.net -e production
```

Set the Amazon Bedrock API key once per environment, before deploying (encrypted; never commit it):

```
forge variables set --encrypt -e production MANTLE_API_KEY
```

After adding new scopes or egress, upgrade each product's install separately:

```
forge install --upgrade -p Jira -s <your-site>.atlassian.net -e production
forge install --upgrade -p Confluence -s <your-site>.atlassian.net -e production
```

## Development

```
npm test                  # unit tests (vitest), no Atlassian access needed
npm run coverage          # tests + coverage; fails if domain code drops below 100%
npm run typecheck         # TypeScript check (tsc --noEmit)
npm run lint              # eslint on the UI Kit frontend (.jsx)
forge lint                # Forge manifest and code checks
forge deploy -e development
forge logs -e development
forge install --upgrade -p Jira -s <your-site>.atlassian.net -e development
forge install --upgrade -p Confluence -s <your-site>.atlassian.net -e development
```

## Evidence-gated summary

- A summary is a list of generated claims, each citing one source. Claims are stored unverified and checked on
  every read, for that viewer, against the cited source's **current** text fetched as the viewer.
- A claim is shown only if it shares a verbatim span with its cited source: at least 12 characters and two
  distinctive words, so stock phrases like "the user cannot" never count. Matching ignores case, spacing,
  Markdown and typographic quotes. This proves a text match, not that the claim is true.
- The matching text must also cover at least half of the claim's distinctive words, so a long claim cannot pass on
  one short shared phrase. Matching is on words, not meaning: a true claim the model reworded too far is rejected too.
- A claim that fails either check is rejected and counted, with the reason "no matching source span".
- In the panel, each shown claim lists its source and the matching text ("From the source"). Rejected claims sit
  behind "see why", struck through, marked "Removed: couldn't match this to the source's wording".
- A claim with no citation, or citing a source the viewer cannot see, is left out entirely: not shown, not
  counted, so nothing reveals it existed. If no claim survives, there is no summary at all.
- Through MCP, rejected claims are returned as `unsupportedClaims`, each with a note telling the agent the claim's
  wording could not be matched to its source, so it must not be presented as a fact.

### How the summary is generated

- Every summary is generated live; nothing is canned, the demo ticket included. During each build, the ticket and
  its incident and resolution excerpts go to **Qwen3-235B on Amazon Bedrock** (via the Mantle endpoint), with
  DeepSeek v3.2 as a fallback if the first model is unavailable.
- Sources are sent under neutral labels (S1, S2, …). The model must cite a label for each claim; Outrider maps it
  back to the ticket. A claim citing an unknown label is never shown.
- The model is asked for short claims, one fact from one source each, in the source's own wording, with no advice.
  It is never asked for an unsupported claim. When it rewords or goes beyond a source, the verifier removes the
  claim, so a rejection appears in some builds and not in others.
- If nothing relevant changed since the last build, the stored claims are reused and no model call is made.
- If generation fails or the model is unreachable, the panel shows the incident and resolution sections without a
  summary.
- Verified on the demo site: Qwen3-235B answered in about 2 seconds from Forge (about 660 input and 180 output
  tokens). For ITS-6265 it gave 6 claims: 5 shown, and 1 rejected (a reworded statement of the SSL fix).

## Data sent outside Atlassian

Outrider calls one external service: **Amazon Bedrock (AWS us-east-1)** at `bedrock-mantle.us-east-1.api.aws`,
to generate summaries. The install screen lists this domain.

- **Sent:** the ticket's summary and description, and the stored excerpts and titles of its related incidents and
  past resolutions, with emails and links replaced by placeholders.
- **Not sent:** account IDs, user fields such as reporter or assignee, ticket keys, or links to Jira. Text inside
  a ticket is sent as written apart from emails and links, so a name typed into a description is included.
- **When:** only during a context build, when the content above changed. Never when the panel opens or MCP is called.
- **Credential:** an Amazon Bedrock API key stored as an encrypted Forge environment variable. It is never in
  code, logs or responses, and judges do not need to provide one.

## How context is chosen

- **Retrieval:** incidents (open, or resolved in the last 30 days) and resolved tickets (last 365 days) are pulled
  from the configured projects. Jira text search is unreliable on the demo site, so a bounded candidate set is
  fetched and scored in the app.
- **Matching:** the ticket's distinctive keywords are compared with each candidate. Summary words count double;
  generic support words ("error", "message", "system") are ignored. A candidate must clear a minimum match to appear.
  For past resolutions, the fix text comes from the agent comment that describes the fix, not the newest comment.
- **Ranking:** a fixed formula weighs similarity (35%), relationship (25%), status (20%, active above resolved),
  recency (10%, 30-day half-life) and source authority (10%). Ties are broken by a shared Affected service,
  then recency, then source key, so the same data always gives the same order.
- **Limits:** up to 20 candidates are stored per ticket; the panel shows at most 5 per section.
- **Staleness:** each bundle records a fingerprint of the ticket fields that affect retrieval. If the ticket changes
  while a build runs, the result is discarded and a fresh build is queued.
- **Current deviations, by design:** keyword overlap stands in for semantic similarity until embeddings are added,
  and relationship strength stays 0 until Teamwork Graph relationships are added.

## Permissions and data access

- **Build as the app, read as the viewer.** Context is retrieved with the app's identity and stored once per
  ticket. Every read is filtered for the person viewing it: one JQL search runs as that viewer for the ticket
  and every source in the stored context, and only issues Jira returns are shown.
- **No access to the ticket:** the panel shows a generic "Outrider context is not available", identical
  whether or not context exists.
- **No access to a source:** the incident or resolution is left out with no placeholder or count. A section
  the viewer cannot see into looks the same as an empty one.
- **Check fails:** nothing is shown. A failed permission check is treated as "not authorized".
- **Revoked access** takes effect on the next read; the stored context does not need to be rebuilt.
- **MCP tool:** the caller is taken from the Rovo invocation context (`principal.accountId`), never from the tool
  inputs, and the ticket is checked as that caller before anything else: no build is queued and nothing is revealed
  for a ticket the caller cannot see. Results then go through the same viewer filter as the panel. Verified via Rovo
  with the same two users: one received the ITO incident and fix for ITS-6265, the other received none.
- Verified on the demo site with two real users: an agent with ITS and ITO access sees the related ITO incident
  and fix on ITS-6265; an ITS-only agent sees empty sections. Granting and then revoking ITO access for the
  second user made the items appear and disappear on Refresh, with the same stored context.

## Testing

- Unit tests live next to the code in `src/**/__tests__/`. Recorded fixtures and integration tests live in `tests/`.
- Integration suites in `tests/integration/` run the real pipeline, storage and panel code with Jira and KVS
  simulated: concurrent builds for one ticket, revoked access after a build, read authorization across viewers,
  MCP caller authorization, and verifier rejection (a recorded Qwen3-235B response for ITS-6265,
  `tests/fixtures/mantle-its-6265.json`, checked against real demo-site text).
- The Bedrock adapter is tested with `fetch` mocked: request shape, fallback, timeouts and errors. CI never calls
  the model.
- Builds for the same ticket are serialized with a per-ticket lock (atomic create-if-absent in Forge KVS, with
  lease expiry) plus write guards. This is best-effort, not strict mutual exclusion; the concurrency tests show
  the newer context wins in the tested interleavings.
- The Jira adapter is tested against responses recorded from the demo site (`tests/fixtures/jira-demo-site.json`),
  so CI never calls Atlassian APIs.
- Domain logic (`src/domain`) is held at 100% branch coverage; `npm run coverage` enforces it.

## Current configuration

The project and field settings are constants in code, matched to the Codegeist demo site:

| Setting | Value | Where |
|---|---|---|
| Projects that get a context bundle | `ITS` | `BUNDLE_PROJECTS` in `src/pipeline/enqueue.ts` |
| Projects searched for incidents and resolutions | `ITS`, `ITO` | `SOURCE_PROJECTS` in `src/adapters/jira.ts` |
| Affected services field | `customfield_10039` | `src/adapters/jira.ts` |
| Request type field | `customfield_10010` | `src/adapters/jira.ts` |

On a site without these projects the panel stays in "Context is being prepared". Making these configurable
per site is planned before submission.

## Architecture

```
Jira event → Queue → Consumer → (Amazon Bedrock: summary claims) → ContextBundle (KVS) → JSM Panel
                                                                                       → Rovo MCP tools
```

| Folder | Contents |
|---|---|
| `src/domain` | Pure types, text matching, verification, prompt building, ranking and fingerprint logic, no Forge imports |
| `src/adapters` | Jira REST calls, the Amazon Bedrock (Mantle) call, and KVS storage |
| `src/pipeline` | Event handler, queue consumer, job routing, bundle builder |
| `src/resolvers` | Panel resolver and MCP action handlers |
| `src/frontend` | UI Kit panel |

