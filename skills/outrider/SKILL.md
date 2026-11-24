---
name: outrider
description: Use Outrider's MCP tools to get checked, permission-filtered context for a Jira Service Management ticket (related incidents, past fixes, runbooks, teams, a verified summary) and emerging-incident signals. Use when a user asks about a service desk ticket, similar past problems, related incidents, who may own a problem, or whether several requests point to one outage.
---

# Outrider

Outrider is a Forge app for Jira Service Management. It prepares each ticket's context when the ticket changes and
checks it again for the person asking. This skill tells an agent which of its four tools to call, how to read the
answers, and what not to claim.

Every answer is filtered for the person the agent acts for: it only contains tickets, pages and teams that person can
open. Never suggest that something is missing because it does not exist; it may only be hidden from this user.

## Connecting

- **Rovo:** in Rovo Studio, create or edit an agent, choose **+ Add tools** → **Outrider** under Connected apps, and
  add the four tools. An agent only uses the tools added to it.
- **Other MCP clients:** Atlassian exposes a Forge app's `rovo:mcp` tools at `https://mcp.atlassian.com/forge/<appId>`
  once a site or org admin turns on the app's tools for external clients (Atlassian Administration → Apps → Sites →
  your site → Connected apps → Outrider). Outrider's app ID is `91f15c4b-555e-4db0-99e1-7567c801fc07`. The client
  signs in with OAuth and acts with the signed-in user's own permissions. Outrider's tools were verified with Rovo
  agents; external clients follow Atlassian's documentation.

## The tools

| Tool | Input | Use it when |
|---|---|---|
| `get-ticket-context` | `ticketKey` (for example `ITS-123`) | The user names a ticket, or asks "what do we know about this ticket" |
| `find-related-incidents` | `ticketKey` and/or `keywords` | The user asks for incidents related to a ticket or to symptoms, for example "VPN disconnects after login" |
| `find-similar-resolutions` | `ticketKey` and/or `description` | The user asks how a similar problem was fixed before |
| `get-emerging-incidents` | optional `projectKey` (for example `ITS`) | The user asks whether there is an outage, a spike, or several requests about the same thing |

Prefer `get-ticket-context` for a named ticket: it returns everything the issue panel shows, including the verified
summary. Use the two find tools for free-text questions or to search without a ticket; they search live on every
call and return at most 5 results.

## Reading the answers

### Status answers

| `status` | Meaning | What to tell the user |
|---|---|---|
| `not-accessible` | The ticket does not exist, or this user cannot see it. The two cases are deliberately identical. | That the ticket was not found or they do not have access. Do not guess which. |
| `not-set-up` | Outrider has not been set up for this project | That a Jira admin needs to set Outrider up for the project |
| `pending` | Context is being built for the first time | To ask again in about a minute |
| `invalid-request` | No signed-in user, or no usable ticket key | Ask for a ticket key such as `ITS-123` |

### `get-ticket-context`

- `incidents`, `resolutions`, `articles`: each item has a `source` with a link and title, and freshness
  (`startedAt`, `resolvedAt` or `updatedAt`). Link the sources when you mention them.
- `resolutions[].resolutionText` is how the ticket was fixed; `matchReason` is `same-symptom`, `same-requester` or
  `both`.
- `summary.claims`: statements that matched their cited source word for word in the source's current text. You may
  state them, citing the source.
- `summary.unsupportedClaims`: statements whose wording could **not** be matched to their source. **Do not present
  them as facts.** If you mention them at all, say they could not be verified.
- `teams` and `teamsNote`: teams **linked** to the project where a related incident is tracked. A linked team is not
  necessarily assigned to, responsible for, or working on the incident. Say "linked team", never "the team
  investigating" or "the responsible team". With no teams, 	eamsNote says so: that does not mean no team is
  involved, so do not name one from other sources.
- `builtAt`: when the context was built. It is rebuilt when the ticket changes.

### `find-related-incidents` and `find-similar-resolutions`

`{ incidents: [...] }` or `{ resolutions: [...] }`, each with `relevance` from 0 to 1. An empty list comes with a
`note` saying nothing was found that this user can see, in the projects Outrider searches. Free-text search is
keyword-based: a one-word query scores every hit as a full match, so ask for a few more words of symptoms when the
user gives only one.

### `get-emerging-incidents`

- `signals[]`: each has `state` (`confirmed` or `uncertain`), `reason` when uncertain, the service and component
  names, the window (`windowStart`, `windowEnd`) and the `requestKeys` this user can see.
- `confirmed` only means the listed requests share the same service and component. `uncertain` means one of the two
  is missing on at least one request. **Neither says how likely an incident is.**
- A signal is advisory. Outrider never creates or declares an incident. Do not say an incident exists, is likely, or
  has not been declared "yet". Recommend investigating the listed requests.
- No signals is a normal answer, and `signalsNote` then says what it means (no group of the site's threshold of
  requests within its window). Say there are no emerging-incident signals right now. Do not group tickets you found
  another way into an emerging incident.

### `partial` and `failures`

When `partial` is `true`, part of the answer could not be checked, and that part was left out rather than guessed:

| Failure | Meaning |
|---|---|
| `auth:jira-check-failed`, `auth:confluence-check-failed`, `auth:cluster-check-failed` | A permission check failed, so the affected items were left out |
| `twg:unavailable` | Teams could not be checked at all; say teams could not be checked, not that there are none |
| `twg:partial` | Some projects' teams could not be checked; the teams listed are real, but there may be more |
| `jira-incidents`, `jira-resolutions` | A live search failed; say the search could not be completed |

## Good answers

- "ITS-6273 matches the open incident ITO-9647 (login failures, started 20 Nov). A past fix, ITO-9642: the SSL
  certificate on the load balancer had expired and was renewed. Runbook: Auth Service Troubleshooting. Linked team:
  Platform Support, linked to the ITO project where ITO-9647 is tracked."
- "There is one confirmed emerging-incident signal in ITS: 5 open requests share the service Infrastructure Services
  and the component VPN Server between 14:05 and 15:35. This is advisory; I'd recommend looking at ITS-6285 to
  ITS-6289 together."

## Avoid

- Stating anything from `unsupportedClaims` as fact.
- Calling a linked team responsible, assigned or investigating.
- Calling a signal an incident, or saying one is likely or about to be declared.
- Saying something does not exist when it may only be hidden from this user.
- Inventing ticket keys, links or fixes that are not in the answer.
