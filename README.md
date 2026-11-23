# Outrider

> Sent ahead. Context in place.

An evidence-gated context engine for Jira Service Management. Outrider surfaces relevant incident history, past resolutions, and runbook knowledge directly in the JSM issue panel — before the agent asks.

Built on Atlassian Forge for Codegeist 2026.

## What it does

- Adds an **Outrider** panel to every JSM issue showing source-grounded context
- Retrieves related incidents and past resolutions from Jira
- Retrieves relevant runbook and KB articles from Confluence, ranked with keywords and embeddings
- Gates every AI-generated summary claim against a verbatim source span — unsupported claims are dropped and counted
- Shows the teams linked (in Atlassian Teams) to the projects of related incidents, via Teamwork Graph
- Flags a possible emerging incident when several open requests name the same affected service and component
  close together in time, from structured fields only, and never creates anything in Jira
- Exposes the same context bundle and signals via Rovo MCP tools for AI agents

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
| 12 | Embedding ranking with Jina (`jina-embeddings-v5-text-small`): keywords choose candidates, embeddings re-rank them and drop weak incidents and runbooks; keyword fallback; verified on ITS-6265 and ITS-6267 | ✅ (development) |
| 13 | Request clustering: emerging-incident signals (confirmed and uncertain) from the Affected services and Components fields, on ticket events plus an hourly sweep; signal card with Dismiss in the panel; MCP tool `get-emerging-incidents`; window and threshold on the settings page; verified live on the demo site | ✅ (development) |
| 14 | Production deploy, judge rehearsal and demo video | 🔜 |

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
2. Open the demo ticket **ITS-6273** ("Cannot log in - getting error on login page"). It replaces ITS-6265, which
   the demo site's SLA clean-up automation closed on 2026-11-23; the tests below that name ITS-6265 use recorded
   copies of it
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

### See an emerging-incident signal

A signal lasts only for its clustering window (90 minutes by default), so the requests for it are created shortly
before a demo rather than kept on the site. To raise one yourself:

1. In the IT Support portal, raise 5 requests of type **Report a system issue** with the same **Affected
   services** value, for example Infrastructure Services, within 90 minutes.
2. As an agent, set the same **Component** on each of them, for example VPN Server.
3. About 20 seconds after the 5th request, open any of them. Above the summary, the panel shows a **Possible
   emerging incident** card marked **Confirmed**, listing the 5 requests and when the signal ends. It ends by
   itself; **Dismiss** hides it from every request in it.

With the same service but no component on at least one request, the card is marked **Uncertain** instead.

### Test the MCP tools via Rovo Studio

1. Open any Jira page on the demo site and click **Ask Rovo** (top-right)
2. Click the agent selector dropdown → **Create agent** → **Start from blank**
3. Click **+ Add tools** → select **outrider** from Connected apps → select **Get ticket context**, **Find related
   incidents**, **Find similar resolutions** and **Get emerging incidents** (each marked "(development)" on the
   demo site) → **Add**.
   An agent only uses the tools added to it; tools added to the app later must be added to the agent too.
4. Click **Test** (top-right) and try:
   - `Use the get-ticket-context tool with ticketKey ITS-6273`: the related active incident (ITO-9647), the past
     resolution (ITO-9642) and the source-matched summary claims; any claim whose wording could not be matched
     comes back separately as unsupported
   - `Find incidents related to ITS-6273`: ITO-9647 (active) and ITO-9642 (resolved)
   - `Find similar resolutions for users seeing 503 errors on the login page`: ITO-9642, with how it was fixed
   - `Find incidents about VPN`: ITO-9649 (active) and ITO-9646 (resolved)
   - `Are there any emerging incidents in ITS?`: the active signals, each with its state, service, component and
     requests, or none (see [Emerging incidents](#emerging-incidents-request-clustering))

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

**`get-emerging-incidents`** (input: optional `projectKey`) returns the active signals for one project, or for every
project that gets context, filtered for the caller exactly like the panel. Each signal has its state
(`confirmed` or `uncertain`), the reason when uncertain, the service and component with their names, the window,
and the requests with evidence. Results come with a `signalsNote` telling the agent that a signal is advisory,
that "confirmed" only means the fields match, and not to say an incident exists or is likely.

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

Set both API keys once per environment, before deploying (encrypted; never commit them). Both are already set in
development; **production still needs both** before the production deploy:

```
forge variables set --encrypt -e production MANTLE_API_KEY   # Amazon Bedrock (Mantle): summaries
forge variables set --encrypt -e production JINA_API_KEY     # Jina AI: embeddings for ranking
```

Without `MANTLE_API_KEY` there is no summary; without `JINA_API_KEY` ranking falls back to keywords. Neither stops
a build. Development and production share one Jina key, so its free tokens (10M, one-time) cover both.

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
- A claim worded the same as an earlier one (ignoring case and punctuation) is dropped, so near-identical sources
  do not repeat a sentence. On the demo site, five requests sharing one description had produced the same claim
  four times.
- If nothing relevant changed since the last build, the stored claims are reused and no model call is made.
- If generation fails or the model is unreachable, the panel shows the incident, resolution and knowledge article
  sections without a summary.
- Verified on the demo site: Qwen3-235B answered in about 2 seconds from Forge (about 660 input and 180 output
  tokens). For ITS-6265 it gave 6 claims: 5 shown, and 1 rejected (a reworded statement of the SSL fix).
  With the related runbook added as a source (step 10), the ITS-6265 prompt is about 1,300 input tokens.
- A claim citing a runbook is checked against the page's current text, fetched as the viewer, the same way as a
  claim citing a Jira issue.

## Data sent outside Atlassian

Outrider calls two external services. The install screen lists both domains.

| Service | Domain | Used for |
|---|---|---|
| **Amazon Bedrock (AWS us-east-1)** | `bedrock-mantle.us-east-1.api.aws` | Generating summaries |
| **Jina AI (part of Elastic)** | `api.jina.ai` | Embeddings for ranking (`jina-embeddings-v5-text-small`) |

- **Sent to Bedrock:** the ticket's summary and description, and the stored excerpts and titles of its related
  incidents, past resolutions and knowledge articles (Confluence runbook and page excerpts, up to 600 characters
  each).
- **Sent to Jina:** the ticket's summary and description, and the title and stored excerpt of each candidate
  incident, past resolution and knowledge article, each cut to 600 characters. Candidates later dropped by
  ranking are sent too (at most 30 per build).
- **For both:** emails and links are replaced by placeholders, and full page bodies are never sent or stored.
- **Not sent:** account IDs, user fields such as reporter or assignee, ticket keys, page IDs, or links to Jira or
  Confluence. Request clustering sends nothing outside Atlassian: it reads only the created time, Affected
  services and Components of open requests, and stores its signals in Outrider's Forge storage. Text inside a ticket is sent as written apart from emails and links, so a name typed into a
  description is included.
- **Training:** Jina's FAQ states: "We never use your API requests, inputs, or outputs to train our embedding,
  reranker, or any other models." Amazon Bedrock does not use inputs to train models.
- **When:** only during a context build. Bedrock is called only when the content above changed; Jina once per
  build. Neither is called when the panel opens or MCP is called.
- **Credentials:** an Amazon Bedrock API key and a Jina API key, stored as encrypted Forge environment variables.
  They are never in code, logs or responses, and judges do not need to provide either.
- **Jina's free tokens:** the Jina key uses Jina's free allowance (10M tokens, one-time). A build uses about
  400–800 tokens on the demo site. When the tokens run out, or Jina is unreachable, ranking falls back to
  keywords and nothing else changes.

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
- **Embeddings (step 12):** keywords choose the candidates; embeddings then judge how close each one is to the
  ticket.
  - One batched call to Jina per build embeds the ticket and its candidates. Each candidate's similarity
    (cosine) becomes the similarity part of the formula, and every section is re-ranked.
  - Incidents and knowledge articles are kept only if they reach at least 60% of the best one's similarity in
    their section. Past resolutions are only re-ordered, because a same-requester match need not be similar.
  - The build log shows the result, as `embeddings for <ticket>: <n> candidate(s), <n> tokens, <n> ms, below the
    floor: <n> article(s), <n> incident(s)`.
  - If Jina fails, times out or has no tokens left, the build keeps the keyword ranking. This is logged only; the
    panel shows nothing about it.
  - The find tools stay on keywords: they search live on every call, and an extra service call per Rovo question
    was not worth it.
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
- **Current deviations, by design:** when embeddings are unavailable, keyword overlap stands in for semantic
  similarity, rather than the spec's 0, so the ranking stays as good as before. Relationship strength stays 0:
  Teamwork Graph is used for the Teams involved section, not for ranking.
- **What embeddings fixed, verified on the demo site:** with keywords alone, the VPN ticket ITS-6267 also showed
  the Auth and Database runbooks (86% of the VPN runbook's keyword score, through "connect" and "connection") and
  the unrelated database incident ITO-9648. With embeddings those score 42–55% of the best match and are dropped:
  ITS-6267 now shows only the VPN runbook and the VPN incident ITO-9649. ITS-6265 still shows the Auth runbook
  and ITO-9647.
- **Why keywords still choose the candidates:** used alone, embeddings rated an unrelated "web 404 error"
  postmortem at 89% of the Auth runbook for the login ticket. The keyword gate never lets it in.

## Teams involved (Teamwork Graph)

- **What it shows:** the teams linked, in Atlassian Teams, to the Jira project of a related incident. For ITS-6265
  that is Platform Support, linked to `ITO`, where the related incident ITO-9647 is tracked. Each team links to
  its profile and says which project and incident connect it. A linked team is not necessarily assigned to the
  incident, and Outrider does not say it is.
- **How:** on every read, for the projects of the related incidents the viewer can see (among the five shown),
  Outrider calls the Teamwork Graph curated query `atlassianTeamsBySpace` as the viewer. Lookups run in parallel
  within 4 seconds. Teams are shown once each, at most 5, and are never stored.
- **Each project on its own:** a project whose lookup fails does not hide the teams of a project that answered.
- **Empty states and failures:**
  - **No team linked:** "No teams linked to this project's space. Link a team to the project in Atlassian Teams to
    see it here."
  - **No related incidents:** "No related incidents to look up teams for." when the viewer sees no related incident.
  - **Some projects failed:** the teams that were found are shown with "Some teams couldn't be checked right now.",
    and the response is marked partial (`twg:partial`).
  - **Every project failed:** "Teams couldn't be checked right now.", no teams, and the response is marked partial
    (`twg:unavailable`).
  - A project that could not be checked is never reported as having no team. The other sections are unchanged.
- **Known Teamwork Graph behaviour on demo sites:** Teamwork Graph intermittently refuses valid reads with HTTP 200
  and "User is not permitted to query this organization", for the same user, query and project. This is
  [reported on the developer community](https://community.developer.atlassian.com/t/teamwork-graph-curated-fields-intermittently-return-user-is-not-permitted-to-query-this-organization/103690)
  for Forge demo sites; another site answered every read.
  - **How Outrider copes:** only that refusal is retried, up to 5 tries per project about 300 ms apart, within
    the 4 seconds. Any other error fails at once. Each failed project is logged with Teamwork Graph's own error
    message.
  - **Measured on the demo site (2026-11-23):**
    - With 3 back-to-back tries, ITS-6275 needed 7 refreshes to show its team.
    - With spaced tries and per-project results, it showed Platform Support on 5 of 5 refreshes, and so did
      ITS-6273.
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

## Emerging incidents (request clustering)

- **What it shows:** a **Possible emerging incident** card on every request in a signal, when several open
  requests in a project that gets context name the same thing within a short window. The card lists the requests,
  says when the signal ends, and recommends investigation. Outrider never creates, links or changes anything in
  Jira, and never says an incident exists.
- **Identity, from structured fields only:** the service comes from the **Affected services** field and the
  component from **Components**. Summaries and descriptions are never used: two requests that only share words
  produce no signal.
- **Confirmed:** at least the threshold of open requests (default 5) share both the same service and the same
  component, and none of them names a different service or component.
- **Uncertain:** the threshold of requests share one half (the service, or the component), at least one of them
  lacks the other half, and none names a different value for it. The card says which half is missing. An uncertain
  signal is not formed beside a confirmed one for the same service or component.
- **Window:** requests count together when they are created within the clustering window (default 90 minutes) of
  the first one. A signal ends when its window ends; requests created later can start a new signal.
- **Lifecycle:** new requests in the window join an active signal. An uncertain signal stays uncertain even if later
  requests add the missing half (spec §14.3); a confirmed signal can form next to it. A signal whose requests drop
  below the threshold, or that gains a conflicting value, ends early. **Dismiss** ends it for everyone, and it is
  not raised again within its window.
- **When it runs:** a clustering pass runs for the project about 20 seconds after any ticket event in it, and an
  hourly sweep runs one for every project that gets context. One pass per project runs at a time. The panel and
  Rovo hide a signal as soon as its end time passes, without waiting for a pass.
- **Who sees it:** each viewer sees a signal only if they can see at least the threshold of its requests, and then
  only those requests. Otherwise there is no card, so nothing reveals that hidden requests exist. Dismiss checks
  the same thing.
- **What is stored:** one record per signal in Outrider's own storage: the service and component IDs and names,
  the request keys, the window and the state. No ticket text. Records are deleted 7 days after their window ends.
- **Limits:** a pass reads at most 200 open requests per project. **Components** is the only supported component
  field: Assets object fields came back empty for the demo-site user, so an Assets choice could not be shown to
  work and is refused on save.
- **For agents:** `get-emerging-incidents` returns the same signals with the same filtering, plus a `signalsNote`.
  Verified via Rovo: before the note was tightened, the agent wrote "no formal incident has been declared yet" and
  called a confirmed signal "a high likelihood of a shared issue"; after, it described "Confirmed (meaning all
  listed requests share the same service and component)" and kept it advisory.
- **Verified live on the demo site (2026-11-23):**
  - 4 requests on Infrastructure Services gave no signal.
  - The 5th, with 3 of the 5 naming VPN Server, gave an uncertain signal.
  - 5 with both service and component gave a confirmed signal next to it.
  - A 6th joined both signals.
  - 3 requests with the Email and Collaboration Services component and no service gave an uncertain signal at
    threshold 3.
  - Dismiss cleared a card from every request in it and from Rovo.
  - Thresholds 1 and 51 were refused on save.
  - A 15-minute signal disappeared from the panel at its end time, before the hourly sweep.

## Permissions and data access

- **Build as the app, read as the viewer.** Context is retrieved with the app's identity and stored once per
  ticket. Every read is filtered for the person viewing it: one JQL search runs as that viewer for the ticket
  and every source in the stored context, and only issues Jira returns are shown.
- **No access to the ticket:** the panel shows a generic "Outrider context is not available", identical
  whether or not context exists.
- **No access to a source:** the incident or resolution is left out with no placeholder or count. A section
  the viewer cannot see into looks the same as an empty one.
- **Check fails:** nothing is shown. A failed permission check is treated as "not authorized".
- **Viewer has not granted access:** Forge's "Allow access" prompt is shown instead of "not available". Outrider
  passes Forge's `NEEDS_AUTHENTICATION_ERR` through from the panel's first check rather than treating it as a
  failure. Before this, a viewer whose grant had lapsed saw "not available" on every ticket and had no way to fix
  it; seen on the demo site on 2026-11-23.
- **Knowledge articles:** one batch page fetch runs as the viewer for every article and every page the summary
  cites, and only pages Confluence returns are shown. A page the viewer cannot see is left out silently, and a
  claim citing it is left out entirely. If the check fails, every article and every claim citing a page is
  dropped and the response is marked partial (`auth:confluence-check-failed`).
- **Teams:** looked up as the viewer on every read, and only for incidents that viewer can see. A viewer who
  cannot see any related incident causes no Teamwork Graph call, so learns nothing about the teams.
- **Emerging-incident signals:** one JQL search as the viewer for every request in the signals being shown. A
  signal appears only if the viewer can see at least its threshold of requests, and then lists only those. If the
  check fails, no signal is shown and the response is marked partial (`auth:cluster-check-failed`).
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
  failed lookup, one project refused while another answers (`twg:partial`), the spaced retries and their deadline,
  that teams are never stored, and MCP per caller. Other read-path suites mock Teamwork Graph
  explicitly as "no linked teams".
- Embedding ranking is tested on real `jina-embeddings-v5-text-small` vectors recorded once from the demo-site
  fixtures (`tests/fixtures/jina-demo-site.json`, 1024 dimensions): the VPN ticket keeps only the VPN runbook and
  the VPN incident, the login ticket keeps the Auth runbook and the login incidents, and embeddings alone would
  keep the 404 postmortem (why the keyword gate stays). The Jina adapter is tested with `fetch` mocked: request
  shape, strict response checks, timeouts and errors, and no call without a key. The builder tests cover the
  re-ranking and the keyword fallback. CI never calls Jina.
- Request clustering: `src/domain/__tests__/cluster.test.ts` covers grouping (confirmed, uncertain, conflicts, no
  signal from free text), windows, lifecycle and idempotency, Dismiss, evidence, filtering per viewer, expiry at
  read time, and storage keys accepted by Forge KVS. `tests/integration/clustering.test.ts` runs the pass, the
  panel, Dismiss and `get-emerging-incidents` end to end across two viewers (one sees the signal, the other does
  not).
- Live testing of clustering on the demo site found three bugs the unit tests had missed, now fixed and tested:
  - **Storage keys:** keys were rejected by Forge storage because they held `%` escapes.
  - **Card text:** the uncertain card said "none names a component" when some did.
  - **Expiry:** a signal stayed on screen after its end time until the next pass (22 minutes in one case).
- Domain logic (`src/domain`) is held at 100% branch coverage; `npm run coverage` enforces it.

## Set up Outrider

Outrider does nothing until a Jira admin sets it up. Until then, its panel says "Outrider isn't set up for this
project yet. Ask a Jira admin to configure it." and no context is built. Setup takes about two minutes and is done
once per site.

**Every setting at a glance.** Each one also has an ⓘ tooltip on the settings page with the same explanation.

| Setting on the page | What it means | Default |
|---|---|---|
| **Projects whose tickets get context** | The service desks where agents should get help. Every ticket here gets the Outrider panel, and these are the projects checked for emerging incidents. | Required |
| **Projects to search for incidents and past resolutions** | Where Outrider looks for that help: current and past incidents, and tickets already solved. Usually the service desk plus the project where incidents are logged. | Required |
| **Confluence spaces to search for runbooks and articles** | The spaces with your how-to guides and runbooks. People only see pages they can already open. | None (no articles) |
| **Affected services field** | The ticket field that says which service is affected. Used to break ties in ranking and as the service for emerging incidents. | Detected |
| **Request type field** | The ticket field that says what kind of request it is. A change to it rebuilds the ticket's context. | Detected |
| **Entity field for clustering** | The ticket field that names the affected part of a service, such as VPN Server. Only **Components** is supported. With **Not used**, only service-level (uncertain) signals can form. | Not used |
| **Clustering window (minutes)** | How close together the requests must arrive to count as one possible emerging incident. The signal ends when this time is up. | 90 (allowed 15 to 10080) |
| **Requests needed for a signal** | How many open requests about the same thing it takes to raise a signal. | 5 (allowed 2 to 50) |

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
| **Affected services field** | The Jira Service Management "Affected services" field. Used to break ties between equally relevant results, and as the service for emerging incidents. | Yes, from the site's field types, marked "Detected automatically". |
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

### 6. Emerging incidents (optional)

Under **Emerging incidents (request clustering)**:

| Setting | What to choose | On the demo site |
|---|---|---|
| **Entity field for clustering** | **Components**, if your agents set the component on requests. This makes confirmed signals possible. Leave **Not used** to group by service only. Any other field is refused: "Entity field for clustering: only Components is supported." | Components |
| **Clustering window (minutes)** | Leave empty for 90. A whole number from 15 to 10080 (7 days). | Empty (90) |
| **Requests needed for a signal** | Leave empty for 5. A whole number from 2 to 50. | Empty (5) |

A value outside the range is refused with, for example, "Requests needed for a signal: enter a whole number from 2
to 50. Your previous settings are still in effect." New values apply from the next clustering pass; a signal
already raised keeps the threshold and window it was raised with.

### 7. Save

Click **Save**. Outrider checks every choice against Jira before saving:

- **Success:** a green message, "Saved. Context is built when a ticket in these projects is created or updated:
  edit a ticket to build its context."
- **A problem:** a red message naming it, for example "Project SUP doesn't exist or Outrider can't see it."
  Nothing is saved, and the previous settings stay in effect.

### 8. Build context for a ticket

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
| Teams involved says "Teams couldn't be checked right now" or "Some teams couldn't be checked right now" | Teamwork Graph refused or did not answer in time; on demo sites it intermittently refuses valid reads | Press **Refresh**; teams are looked up again on every read |
| The panel shows Forge's "Allow access" prompt | You have not granted Outrider access to act as you, or the grant lapsed | Click it and approve; the panel then loads |
| No emerging-incident card although several requests look alike | Clustering uses only the Affected services and Components fields, not the text. The requests may lack those values, differ in them, be spread over more than the window, or be fewer than the threshold | Set the same service (and component) on the requests; check the window and threshold (step 6) |
| Only **Uncertain** cards, never **Confirmed** | **Entity field for clustering** is **Not used**, or the requests have no component | Choose **Components** (step 6) and set the component on the requests |
| A signal you expected is gone | Its window ended, it was dismissed, or its requests dropped below the threshold | Signals are short-lived by design; new requests can start a new one |

Verified on two sites: the demo site (`ITS` / `ITS`, `ITO`; fields `customfield_10039` and `customfield_10010`
detected) and a second site set up only through this page (`DEMO`, `OD`; Affected services detected as
`customfield_10048`), where an `OD` ticket then showed the related incident `OD-5` and a live summary.
## Design and decisions

Outrider was specified before it was built. [`docs/spec.md`](docs/spec.md) is that specification: the data model,
the source-span verifier, read-time authorization, ranking, failure handling, the required security tests, and the
build sequence and cut order.

As each step was built, the spec gained a **"Decisions made during implementation"** section for that phase,
recording where reality changed the plan and why, usually with a measurement. Examples:

- Teamwork Graph moved to read time only, after a probe showed the build queue cannot call it.
- The embeddings provider was chosen by checking each provider's own pricing and terms pages.
- The article and incident floors were set from scores measured on recorded demo-site data.

Some parts of the spec were not built, for example the Confluence index and Assets as a clustering field. **This
README is the authority on what the submission does**; the spec explains why it works the way it does.

## Architecture

```
Jira event → Queue → Consumer → (Jina: embeddings for ranking) → (Amazon Bedrock: summary claims) → ContextBundle (KVS) → JSM Panel
                                                                                                                        → Rovo MCP tools
Read time, as the viewer: Jira and Confluence visibility, live text for the verifier, Teamwork Graph teams
Jira event (+20 s) / hourly sweep → Queue → clustering pass per project → signal records (KVS) → panel card, get-emerging-incidents
```

| Folder | Contents |
|---|---|
| `src/domain` | Pure types, text matching, verification, prompt building, ranking and fingerprint logic, no Forge imports |
| `src/adapters` | Jira and Confluence REST calls, Teamwork Graph queries, the Jina embeddings call, the Amazon Bedrock (Mantle) call, and KVS storage |
| `src/pipeline` | Event handler, queue consumer, job routing, bundle builder |
| `src/resolvers` | Panel resolver and MCP action handlers |
| `src/frontend` | UI Kit panel |

