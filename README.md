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
| 6c-3 | MCP caller identity and authorization gate for `get-ticket-context` | 🔜 |
| 7–14 | Verifier, AI summary, remaining MCP tools, Confluence, TWG, demo | 🔜 |

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
3. The **Outrider** panel in the right-side context section shows the related active incident and past resolution,
   each with a source link, freshness and a match label (Strong, Good or Partial)

Context is built when a ticket is created or updated, not when the panel opens. A ticket that has not changed
since Outrider was installed shows "Context is being prepared": edit any field (for example Urgency), wait a
minute or two for the Jira event, then press **Refresh** at the top of the panel. Refresh only re-reads stored context.

### Test the MCP tool via Rovo Studio

1. Open any Jira page on the demo site and click **Ask Rovo** (top-right)
2. Click the agent selector dropdown → **Create agent** → **Start from blank**
3. Click **+ Add tools** → select **outrider** from Connected apps → select **Get ticket context (development)** → **Add**
4. Click **Test** (top-right) and send: `Use the get-ticket-context tool with ticketKey ITS-6265`
5. The tool returns a `ContextBundle` with `ticketKey`, `builtAt`, and source arrays

> **Note:** The MCP tool still returns a stub bundle (empty source arrays). The panel already serves real, per-viewer filtered context; the MCP tool gets the same in step 6c-3.

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

After adding new scopes, upgrade each product's install separately:

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
- Verified on the demo site with two real users: an agent with ITS and ITO access sees the related ITO incident
  and fix on ITS-6265; an ITS-only agent sees empty sections. Granting and then revoking ITO access for the
  second user made the items appear and disappear on Refresh, with the same stored context.

## Testing

- Unit tests live next to the code in `src/**/__tests__/`. Recorded fixtures and integration tests live in `tests/`.
- Integration suites in `tests/integration/` run the real pipeline, storage and panel code with Jira and KVS
  simulated: concurrent builds for one ticket, revoked access after a build, and read authorization across viewers.
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
Jira event → Queue → Consumer → ContextBundle (KVS) → JSM Panel
                                                    → Rovo MCP tools
```

| Folder | Contents |
|---|---|
| `src/domain` | Pure types, text matching, ranking and fingerprint logic, no Forge imports |
| `src/adapters` | Jira REST calls and KVS storage |
| `src/pipeline` | Event handler, queue consumer, job routing, bundle builder |
| `src/resolvers` | Panel resolver and MCP action handlers |
| `src/frontend` | UI Kit panel |

