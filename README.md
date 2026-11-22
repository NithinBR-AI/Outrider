# Outrider

> Sent ahead. Context in place.

An evidence-gated context engine for Jira Service Management. Outrider surfaces relevant incident history, past resolutions, and runbook knowledge directly in the JSM issue panel — before the agent asks.

Built on Atlassian Forge for Codegeist 2026.

## What it does

- Adds an **Outrider** panel to every JSM issue showing source-grounded context
- Retrieves related incidents and past resolutions from Jira
- Retrieves relevant runbook and KB articles from Confluence
- Gates every AI-generated summary claim against a verbatim source span — unsupported claims are dropped and counted
- Shows the teams linked (in Atlassian Teams) to the projects of related incidents, via Teamwork Graph
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
| 9 | MCP tools `find-related-incidents` and `find-similar-resolutions` (live search, per-caller filtering), verified with two users via Rovo | ✅ (development) |
| 9.5 | Per-site settings page (projects, detected fields), "isn't set up" state, no hardcoded projects or fields; verified on the demo site and a second site | ✅ (development) |
| 10 | Knowledge articles from Confluence (live search, rarity-weighted matching, read-time check as the viewer), spaces on the settings page, articles as summary sources; verified with two users on the demo site | ✅ (development) |
| 11 | Teams involved via Teamwork Graph, looked up as the viewer at read time (team linked to the project of a related incident), in the panel and `get-ticket-context`; verified with two users on the demo site | ✅ (development) |
| 12–14 | Embeddings, clustering, demo | 🔜 |

## Install

> **Judges:** You must be a site admin of the Atlassian site you install on. The app requires installation on both Jira and Confluence.

[Install Outrider](https://developer.atlassian.com/console/install/91f15c4b-555e-4db0-99e1-7567c801fc07?signature=AYABeJea9AN5%2BgVEUoMfUTwDwJMAAAADAAdhd3Mta21zAEthcm46YXdzOmttczp1cy13ZXN0LTI6NzA5NTg3ODM1MjQzOmtleS83MDVlZDY3MC1mNTdjLTQxYjUtOWY5Yi1lM2YyZGNjMTQ2ZTcAuAECAQB4CxqLTo9l4lqXuFjNim1xJM%2Bp%2F3TVP9xHS2BrU5DRRucB3IRbHYCugUXrJrT%2B3qZRfwAAAH4wfAYJKoZIhvcNAQcGoG8wbQIBADBoBgkqhkiG9w0BBwEwHgYJYIZIAWUDBAEuMBEEDLwSiW1oRQUP7NZshAIBEIA7XICglS%2BoVEwMrLjoUVsgMgF4U5dMn6c8jEbAwj%2BwEKfulJ0v%2Frz%2FvkLJMaedKu%2FE%2B0HmKBQ9LFiczA0AB2F3cy1rbXMAS2Fybjphd3M6a21zOmV1LXdlc3QtMTo3MDk1ODc4MzUyNDM6a2V5LzQ2MzBjZTZiLTAwYzMtNGRlMi04NzdiLTYyN2UyMDYwZTVjYwC4AQICAHi9bVMAkme4qVQX1fQHo6ePw3H40A7cGfz7yrmSfBWMXgGx1s%2FbJa9p1OYmxHefjQyWAAAAfjB8BgkqhkiG9w0BBwagbzBtAgEAMGgGCSqGSIb3DQEHATAeBglghkgBZQMEAS4wEQQMasJ8HuRtdj33ChyCAgEQgDuKlLnDahUrzxNtd3QHq9h1oawh2EO2IeiH7K60hup4dLFQGz1DcWZ2kWZiYBcyjvFPF3wBacT%2F8XfFNQAHYXdzLWttcwBLYXJuOmF3czprbXM6dXMtZWFzdC0xOjcwOTU4NzgzNTI0MzprZXkvNmMxMjBiYTAtNGNkNS00OTg1LWI4MmUtNDBhMDQ5NTJjYzU3ALgBAgIAeDYASx0XCjkny4iLV6vz%2BKtEGSGT6kdt0QRpkn6D%2FlVEATjuS4HsiPRVF5%2FWjRHs6E0AAAB%2BMHwGCSqGSIb3DQEHBqBvMG0CAQAwaAYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAyYlOz80QTFCAljtRQCARCAO3BbtwjzWy4x0mNH4UxeUxkPgrhttRE0P1Zp9EwnPqCY3b%2FQvv4L9OdNtKUXtzbyjmjRIkkYwMlL9q7EAgAAAAAMAAAQAAAAAAAAAAAAAAAAAE5jtzTNDmMVPSR5GzfBZMT%2F%2F%2F%2F%2FAAAAAQAAAAAAAAAAAAAAAQAAADJqxdE4UiqUgSdvbgvE1DVp5PfTH0x1fTTkhvPSnKyUK%2FjKO1gCGuN5Req2C0W6AMDJSgGgVXJiPyhRkoU4%2B7LneFY%3D&product=confluence&product=jira)

**After installing, a Jira admin must set up Outrider** (about two minutes): choose the projects it works in on its
settings page, then edit a ticket. Step by step: [Set up Outrider](#set-up-outrider).

## Demo site

The Codegeist provisioned demo site has Rovo Enterprise, seeded JSM data, and Confluence knowledge bases.
During development it runs the **development** environment of Outrider (the panel shows a **DEV** badge).
The install link above installs the **production** environment, which is updated before submission.

**Site:** `one-atlas-edlg.atlassian.net` (expires 2027-02-18)

Outrider is set up there through its [settings page](#set-up-outrider): context for `ITS` tickets, searching `ITS` and
`ITO` for incidents and resolutions, and the Confluence space `ITO` for knowledge articles. In Atlassian Teams,
the team **Platform Support** is linked to the `ITO` project, which is what the Teams involved section shows.

### See the JSM panel

1. Go to [IT Support queue](https://one-atlas-edlg.atlassian.net/jira/servicedesk/projects/ITS/queues/custom/1)
2. Open the demo ticket **ITS-6265** ("Cannot log in - getting error on login page")
3. The **Outrider** panel in the right-side context section shows a live-generated summary (claims with their
   matching source text, and any rejected claims behind "see why"), then the related active incident, the past
   resolution and the related runbook (Auth Service Troubleshooting Runbook), each with a source link, freshness
   and a match label (Strong, Good or Partial)
4. Under the incidents, **Teams involved** shows **Platform Support**, linked to its team profile, with
   "Linked to the ITO project, where ITO-9647 is tracked"
5. The incidents, teams, resolutions and knowledge articles sections start expanded. Each has its own
   **Show less** / **Show more** button next to its heading; an empty section shows a short message and no button

Context is built when a ticket is created or updated, not when the panel opens. A ticket that has not changed
since Outrider was installed shows "Context is being prepared": edit any field (for example Urgency), wait a
minute or two for the Jira event, then press **Refresh** at the top of the panel. Refresh only re-reads stored context.

### Test the MCP tools via Rovo Studio

1. Open any Jira page on the demo site and click **Ask Rovo** (top-right)
2. Click the agent selector dropdown → **Create agent** → **Start from blank**
3. Click **+ Add tools** → select **outrider** from Connected apps → select **Get ticket context**, **Find related
   incidents** and **Find similar resolutions** (each marked "(development)" on the demo site) → **Add**.
   An agent only uses the tools added to it; tools added to the app later must be added to the agent too.
4. Click **Test** (top-right) and try:
   - `Use the get-ticket-context tool with ticketKey ITS-6265`: the related active incident (ITO-9647), the past
     resolution (ITO-9642) and the source-matched summary claims; any claim whose wording could not be matched
     comes back separately as unsupported
   - `Find incidents related to ITS-6265`: ITO-9647 (active) and ITO-9642 (resolved)
   - `Find similar resolutions for users seeing 503 errors on the login page`: ITO-9642, with how it was fixed
   - `Find incidents about VPN`: ITO-9649 (active) and ITO-9646 (resolved)

**`get-ticket-context`** (input: `ticketKey`) returns the same context as the panel, filtered for whoever is asking:
incidents, resolutions and knowledge articles with source links and freshness (`builtAt`), the teams involved (see
[Teams involved](#teams-involved-teamwork-graph)), plus the verified summary (see
[Evidence-gated summary](#evidence-gated-summary)). Internal build fields are left out. For a ticket with no context
yet it answers "being prepared" and queues a build; ask again a minute later.

**`find-related-incidents`** (inputs: `ticketKey` and/or `keywords`) and **`find-similar-resolutions`** (inputs:
`ticketKey` and/or `description`) search live on every call, with the same matching and ranking as the panel, so
they also work for tickets that never get a stored context (for example ITO incidents):

- **Ticket and text:** the ticket wins; the text is only a hint added to it. Text alone searches by symptoms.
  The issue the user is viewing is used only when no input is given at all.
- **Results:** at most 5, the same as the panel shows per section. Each carries a source link, freshness
  (`startedAt` or `resolvedAt`), relevance, and for resolutions the fix text and match reason.
- **Shape:** `{ incidents: [...] }` or `{ resolutions: [...] }`, with `partial` and `failures`. This wraps the
  plain lists in spec §15.2/§15.3 on purpose, so an agent can tell "nothing found" from "no access" and from
  "could not check".
- **Filtering:** results the caller cannot see are dropped without a trace. If the check fails, nothing is
  returned and the answer is marked partial.

For every tool, a ticket the caller cannot see, or one that does not exist, gets the same "not found or no
access" answer, and nothing is read, searched or queued for it. On a site that is not [set up](#set-up-outrider),
the tools answer with the same "isn't set up" message as the panel (after that ticket check), and
`get-ticket-context` also gives it for tickets outside the projects that get context.

**Known quirks of free-text search:** matching is on keywords, so a one-word query such as "VPN" scores every
hit as a full match (relevance 1.0), and a generic term can pull in a weak match (on the demo site, "503" also
finds the unrelated Webstore incident ITO-9630, at relevance 0.33). A resolved incident can appear in both
find tools, because each tool is independent; the panel shows it once.

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
  its incident, resolution and knowledge article excerpts go to **Qwen3-235B on Amazon Bedrock** (via the Mantle endpoint), with
  DeepSeek v3.2 as a fallback if the first model is unavailable.
- Sources are sent under neutral labels (S1, S2, …). The model must cite a label for each claim; Outrider maps it
  back to the ticket. A claim citing an unknown label is never shown.
- The model is asked for short claims, one fact from one source each, in the source's own wording, with no advice.
  It is never asked for an unsupported claim. When it rewords or goes beyond a source, the verifier removes the
  claim, so a rejection appears in some builds and not in others.
- If nothing relevant changed since the last build, the stored claims are reused and no model call is made.
- If generation fails or the model is unreachable, the panel shows the incident, resolution and knowledge article
  sections without a summary.
- Verified on the demo site: Qwen3-235B answered in about 2 seconds from Forge (about 660 input and 180 output
  tokens). For ITS-6265 it gave 6 claims: 5 shown, and 1 rejected (a reworded statement of the SSL fix).
  With the related runbook added as a source (step 10), the ITS-6265 prompt is about 1,300 input tokens.
- A claim citing a runbook is checked against the page's current text, fetched as the viewer, the same way as a
  claim citing a Jira issue.

## Data sent outside Atlassian

Outrider calls one external service: **Amazon Bedrock (AWS us-east-1)** at `bedrock-mantle.us-east-1.api.aws`,
to generate summaries. The install screen lists this domain.

- **Sent:** the ticket's summary and description, and the stored excerpts and titles of its related incidents,
  past resolutions and knowledge articles (Confluence runbook and page excerpts, up to 600 characters each), with
  emails and links replaced by placeholders. Full page bodies are never sent or stored.
- **Not sent:** account IDs, user fields such as reporter or assignee, ticket keys, page IDs, or links to Jira or Confluence. Text inside
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
- **Knowledge articles:** searched live in the configured Confluence spaces during each build; there is no index.
  - **Search:** one CQL search as the app for any of the ticket's 8 strongest keywords (up to 25 pages). If CQL
    finds nothing or fails, Outrider lists the most recently modified pages in those spaces instead. The build
    log records which path was used, as `articles for <ticket>: cql|recent-pages, <n> candidate(s), <n> related`.
  - **Matching:** each ticket keyword counts in proportion to how rare it is among that build's candidate pages,
    so words found in most runbooks ("log", "page") count for little and words found in one ("vpn", "cache")
    count for a lot. A page is kept only if it reaches a score of 0.2 and at least 60% of the best page's score.
    On the demo site this keeps only the Auth runbook for ITS-6265, including when the ticket has only a summary.
  - **Ranking:** the same formula as above, with status fixed at 0.2, recency from the page's last update, and
    authority 1.0 for runbooks and policies and 0.7 for other pages (from the page's labels, or its title when
    it has none).
- **Limits:** up to 20 candidates are stored per ticket; the panel shows at most 5 per section. Only article
  excerpts (up to 600 characters) are stored, never full page text.
- **Staleness:** each bundle records a fingerprint of the ticket fields that affect retrieval. If the ticket changes
  while a build runs, the result is discarded and a fresh build is queued.
- **Current deviations, by design:** keyword overlap stands in for semantic similarity until embeddings are added,
  and relationship strength stays 0: Teamwork Graph is used for the Teams involved section, not for ranking.
- **Known limit of keyword matching for articles:** pages that share a generic word with the ticket can still
  tie. For the VPN ticket ITS-6267 the VPN runbook ranks first, but the Auth and Database runbooks are also kept
  (86% of its score) because they contain "connect" and "connection". Embeddings are planned to resolve this.

## Teams involved (Teamwork Graph)

- **What it shows:** the teams linked, in Atlassian Teams, to the Jira project of a related incident. For ITS-6265
  that is Platform Support, linked to `ITO`, where the related incident ITO-9647 is tracked. Each team links to
  its profile and says which project and incident connect it. A linked team is not necessarily assigned to the
  incident, and Outrider does not say it is.
- **How:** on every read, for the projects of the related incidents the viewer can see (among the five shown),
  Outrider calls the Teamwork Graph curated query `atlassianTeamsBySpace` as the viewer. Lookups run in parallel
  within 4 seconds. Teams are shown once each, at most 5, and are never stored.
- **Empty states:** "No teams linked to this project's space. Link a team to the project in Atlassian Teams to see
  it here." when no team is linked; "No related incidents to look up teams for." when the viewer sees no related
  incident; "Teams couldn't be checked right now." when the lookup failed or ran out of time. A failure drops all
  teams, marks the response partial (`twg:unavailable`) and leaves the other sections unchanged.
- **For agents:** `get-ticket-context` returns `teams` with the same evidence, plus a `teamsNote` saying the team
  is linked to the project, not assigned to or working on the incident. Verified via Rovo: without the note the
  agent wrote "Platform Support is currently investigating"; with it, "Linked Team: Platform Support (linked to the
  ITO project where the incident is tracked)". The find tools do not return teams.
- **Why read time only:** Forge apps can call Teamwork Graph only as a user, and on the demo site the build queue
  cannot call it at all (`asUser()`: 401 `AUTH_TYPE_UNAVAILABLE`; `asUser(accountId)`: 401
  `NO_IMPERSONATION_SCOPES_DEFINED`). Looking teams up as each viewer on each read means there is nothing stored
  to re-check.
- **Why the project link and not the assignee:** every demo-site incident assignee with teams belongs to 9 to 18
  of them, so "the assignee's teams" could not say which team is involved. No demo-site incident has the Jira Team
  field set either.
- **Scopes:** `read:graph:project:jira` and `read:graph:team:atlassian` only. A missing or declined scope makes
  Teamwork Graph return an empty list rather than an error, so the section then shows "No teams linked".

## Permissions and data access

- **Build as the app, read as the viewer.** Context is retrieved with the app's identity and stored once per
  ticket. Every read is filtered for the person viewing it: one JQL search runs as that viewer for the ticket
  and every source in the stored context, and only issues Jira returns are shown.
- **No access to the ticket:** the panel shows a generic "Outrider context is not available", identical
  whether or not context exists.
- **No access to a source:** the incident or resolution is left out with no placeholder or count. A section
  the viewer cannot see into looks the same as an empty one.
- **Check fails:** nothing is shown. A failed permission check is treated as "not authorized".
- **Knowledge articles:** one batch page fetch runs as the viewer for every article and every page the summary
  cites, and only pages Confluence returns are shown. A page the viewer cannot see is left out silently, and a
  claim citing it is left out entirely. If the check fails, every article and every claim citing a page is
  dropped and the response is marked partial (`auth:confluence-check-failed`).
- **Teams:** looked up as the viewer on every read, and only for incidents that viewer can see. A viewer who
  cannot see any related incident causes no Teamwork Graph call, so learns nothing about the teams.
- **Revoked access** takes effect on the next read; the stored context does not need to be rebuilt.
- **MCP tools:** the caller is taken from the Rovo invocation context (`principal.accountId`), never from the tool
  inputs, and a named ticket is checked as that caller before anything else: no build is queued, nothing is read
  or searched, and nothing is revealed for a ticket the caller cannot see. Results then go through the same viewer
  filter as the panel. Verified via Rovo with the same two users: for `get-ticket-context` one received the ITO
  incident and fix for ITS-6265, the other received none. For the find tools, the ITO user got ITO-9647, ITO-9642,
  ITO-9649 and ITO-9646 across four queries; the ITS-only user got no ITO result for any of them, and for
  ITO-9647 got the "does not exist or no access" answer.
- Verified on the demo site with two real users: an agent with ITS and ITO access sees the related ITO incident
  and fix on ITS-6265; an ITS-only agent sees empty sections. Granting and then revoking ITO access for the
  second user made the items appear and disappear on Refresh, with the same stored context.
- Knowledge articles verified on the demo site with the same two users: the ITO user sees the Auth runbook on
  ITS-6265; the second user, who cannot see the ITO space, sees all three sections with "No items". Page-level
  restrictions and revoked page access are covered by the integration tests rather than by changing site
  permissions.
- Teams verified on the demo site with the same two users: the ITO user sees Platform Support on ITS-6265, in the
  panel and via Rovo; the second user sees "No related incidents to look up teams for."

## Testing

- Unit tests live next to the code in `src/**/__tests__/`. Recorded fixtures and integration tests live in `tests/`.
- Integration suites in `tests/integration/` run the real pipeline, storage and panel code with Jira and KVS
  simulated: concurrent builds for one ticket, revoked access after a build, read authorization across viewers,
  MCP caller authorization for `get-ticket-context` and for the two find tools, and verifier rejection (a recorded Qwen3-235B response for ITS-6265,
  `tests/fixtures/mantle-its-6265.json`, checked against real demo-site text).
- The Bedrock adapter is tested with `fetch` mocked: request shape, fallback, timeouts and errors. CI never calls
  the model.
- Builds for the same ticket are serialized with a per-ticket lock (atomic create-if-absent in Forge KVS, with
  lease expiry) plus write guards. This is best-effort, not strict mutual exclusion; the concurrency tests show
  the newer context wins in the tested interleavings.
- The Jira adapter is tested against responses recorded from the demo site (`tests/fixtures/jira-demo-site.json`),
  so CI never calls Atlassian APIs.
- The Confluence adapter and article matching are tested against pages recorded from the demo site's `ITO` space
  (`tests/fixtures/confluence-demo-site.json`, 13 pages) and the recorded tickets ITS-6265 and ITS-6267
  (`tests/fixtures/jira-its-6267.json`): which runbooks each ticket keeps, the CQL and recent-pages paths, and
  the viewer fetch.
- `tests/integration/confluence-authorization.test.ts` checks articles across two viewers (one sees the runbooks,
  the other sees none), MCP `get-ticket-context` with the same filter, claims citing runbooks against the page's
  current text, and a failed Confluence check. `tests/integration/revoked-access.test.ts` also covers revoked and
  restored access to a page without a rebuild.
- The Teamwork Graph adapter is tested against responses recorded on the demo site
  (`tests/fixtures/twg-demo-site.json`): Platform Support for `ITO`, nothing for `ITS`, and every failure path,
  including the time budget. `tests/integration/teams-authorization.test.ts` checks teams across viewers (one sees
  Platform Support, the other gets no team and causes no call), a fresh lookup on every read, revoked access, a
  failed lookup, that teams are never stored, and MCP per caller. Other read-path suites mock Teamwork Graph
  explicitly as "no linked teams".
- Domain logic (`src/domain`) is held at 100% branch coverage; `npm run coverage` enforces it.

## Set up Outrider

Outrider does nothing until a Jira admin sets it up. Until then, its panel says "Outrider isn't set up for this
project yet. Ask a Jira admin to configure it." and no context is built. Setup takes about two minutes and is done
once per site.

### 1. Open the settings page

You must be a **Jira admin** on the site. The page itself opens in Jira's settings. Atlassian Administration's
**Atlassian apps** page (products and plans) does not lead to it, but its **Connected apps** list does (below).
Any of these opens it:

- **From the Outrider panel:** on any ticket, while Outrider is not set up, the panel says "Outrider isn't set up
  for this project yet" with a link, **Open Outrider settings**.
- **From Jira's app list:**
  1. In Jira, click the **cog icon (Settings)** at the top right.
  2. Under **Jira admin settings**, click **Marketplace apps**.
  3. The page says "App management has moved to Administration". Click **Take me there**.
  4. You are now on **Connected apps** in Atlassian Administration. In the **Installed apps** list, find
     **outrider**. It appears as a group with one row per product it is installed in.
  5. On an **outrider** row, click **⋯** at the right end and choose **Configure**. (On the demo site only one
     of the rows has a **⋯** menu; that is the one.)
  6. The Outrider settings page opens in Jira.
- **Direct link**, replacing `<your-site>` with your site name:

  ```
  https://<your-site>.atlassian.net/jira/settings/apps/configure/91f15c4b-555e-4db0-99e1-7567c801fc07/9642b7bf-2691-4a10-a588-4149d578afc9
  ```

  The last two parts are Outrider's app ID and its environment ID; the one above is the **production**
  environment, which the install link installs. On the demo site, which runs the development environment, the
  page is at [`/jira/settings/apps/configure/91f15c4b-555e-4db0-99e1-7567c801fc07/e0550813-1dd2-42b6-a586-7b66793ab580`](https://one-atlas-edlg.atlassian.net/jira/settings/apps/configure/91f15c4b-555e-4db0-99e1-7567c801fc07/e0550813-1dd2-42b6-a586-7b66793ab580).

The page is titled **Outrider**. On a site that has not been set up it shows a blue notice: "Outrider isn't set up
yet."
### 2. Choose the projects

| Setting | What to choose | Example on the demo site |
|---|---|---|
| **Projects whose tickets get context** | The projects where agents work tickets, usually your service desk projects. The Outrider panel shows context on tickets in these projects; elsewhere it says it isn't set up. | IT Support (`ITS`) |
| **Projects to search for incidents and past resolutions** | Every project whose tickets Outrider should draw on: the service desk projects themselves (for past resolutions) and any project where incidents are tracked. | `ITS` and `ITO` |

- Both lists show only the projects Outrider can see. If a project is missing, Outrider does not have access to it.
- Choose at least one project in each list, and at most 20.
- Incidents are found only if they are issues of type **[System] Incident**, the Jira Service Management IT service
  management type. A site without that type gets no incidents; past resolutions still work.

### 3. Check the fields

| Setting | What it is | Filled in automatically? |
|---|---|---|
| **Affected services field** | The Jira Service Management "Affected services" field. Used to break ties between equally relevant results. | Yes, from the site's field types, marked "Detected automatically". |
| **Request type field** | The Jira Service Management "Request type" field. | Yes, the same way. |

You normally leave both as detected. Field IDs differ between sites (for example `customfield_10039` on the demo
site and `customfield_10048` on another site we tested), which is why they are detected rather than typed. Choose
**Not used** if your site has no such field; Outrider still works.

### 4. Choose Confluence spaces (optional)

Under **Knowledge articles (Confluence)**, choose the spaces that hold your runbooks and articles in **Confluence
spaces to search for runbooks and articles**. On the demo site this is `ITO`. With no spaces chosen, the panel's
Knowledge articles section stays empty and everything else works.

Outrider sees only the Confluence spaces it is a member of, so the list shows only those. To add a space:

1. In Confluence, open the space and go to **Space settings** → **Members** (or the space's permissions page).
2. Add the **Outrider** app as a member with view access. On the demo site both Outrider apps were added, the
   production one and the development one.
3. Reload the Outrider settings page; the space now appears in the list.

New access can take **10 to 15 minutes** to reach Confluence search (measured on the demo site: about 13 minutes).
Until then, Outrider lists the space's most recently modified pages instead, so articles still appear.

If Outrider is not installed in Confluence on the site, the page shows "Confluence spaces could not be listed" and
the other settings still work.

### 5. Link teams to projects (optional, in Atlassian Teams)

The panel's **Teams involved** section shows the teams linked to the projects of related incidents. This is set
in Atlassian, not on the Outrider page. To link a team to a Jira project, open the project in Jira, select the
**team icon** next to its name, search for the team and select **Add** ([Atlassian's guide](https://support.atlassian.com/platform-experiences/docs/using-atlassian-teams-in-jira-projects/)).
On the demo site, Platform Support is linked to `ITO`. Teamwork Graph showed the new link about a minute later.

### 6. Save

Click **Save**. Outrider checks every choice against Jira before saving:

- **Success:** a green message, "Saved. Context is built when a ticket in these projects is created or updated:
  edit a ticket to build its context."
- **A problem:** a red message naming it, for example "Project SUP doesn't exist or Outrider can't see it."
  Nothing is saved, and the previous settings stay in effect.

### 7. Build context for a ticket

Context is built when a ticket changes, not when you save the settings. Open a ticket in one of the projects that
get context, **change any field** (for example Priority), wait up to a minute, then reload the ticket. The
Outrider panel shows the related incidents and past resolutions and, when there are sources, a summary.

Tickets that existed before setup show "Context is being prepared" until they are next updated. **Refresh** in the
panel only re-reads stored context; it never starts a build.

### Changing the settings later

Open the same page, change the lists or fields, and save. The new settings apply from the next ticket update.
Tickets in a project you remove show "isn't set up" again; their stored context is kept but no longer shown.

### If something looks wrong

| What you see | Why | What to do |
|---|---|---|
| Panel says "Outrider isn't set up for this project yet" | The site has no saved settings, or this ticket's project is not in "Projects whose tickets get context" | Click **Open Outrider settings** in the panel (Jira admins) and add the project |
| Panel stays on "Context is being prepared" | The ticket has not changed since setup, or its build is still running | Change a field on the ticket, wait a minute, reload |
| The page shows "Outrider could not read projects and fields from Jira just now" | Jira did not answer | Reload the page |
| No incidents ever appear | The searched projects have no issues of type [System] Incident | Add the project where incidents are tracked to "Projects to search" |
| Knowledge articles always shows "No items" | No Confluence spaces are chosen, Outrider is not a member of the space, or the ticket shares no distinctive words with any page | Choose a space in step 4, add Outrider as a member of it, then change a field on the ticket to rebuild |
| A space is missing from the Confluence list | Outrider is not a member of that space | Add Outrider in the space's settings, then reload the settings page |
| Teams involved says "No teams linked to this project's space" | No team is linked to the related incident's project, or the admin declined the Teamwork Graph scopes | Link a team to the project (step 5), or check Outrider's permissions under Connected apps |

Verified on two sites: the demo site (`ITS` / `ITS`, `ITO`; fields `customfield_10039` and `customfield_10010`
detected) and a second site set up only through this page (`DEMO`, `OD`; Affected services detected as
`customfield_10048`), where an `OD` ticket then showed the related incident `OD-5` and a live summary.
## Architecture

```
Jira event → Queue → Consumer → (Amazon Bedrock: summary claims) → ContextBundle (KVS) → JSM Panel
                                                                                       → Rovo MCP tools
Read time, as the viewer: Jira and Confluence visibility, live text for the verifier, Teamwork Graph teams
```

| Folder | Contents |
|---|---|
| `src/domain` | Pure types, text matching, verification, prompt building, ranking and fingerprint logic, no Forge imports |
| `src/adapters` | Jira and Confluence REST calls, Teamwork Graph queries, the Amazon Bedrock (Mantle) call, and KVS storage |
| `src/pipeline` | Event handler, queue consumer, job routing, bundle builder |
| `src/resolvers` | Panel resolver and MCP action handlers |
| `src/frontend` | UI Kit panel |

