# Outrider

> Sent ahead. Context in place.

An evidence-gated context engine for Jira Service Management. Outrider surfaces verified incident history, resolutions, and runbook knowledge directly in the JSM issue panel — before the agent asks.

Built on Atlassian Forge for Codegeist 2026.

## What it does

- Adds a collapsible **Outrider** panel to every JSM issue
- Retrieves related incidents, past resolutions, and Confluence runbooks
- Verifies every AI-generated claim against verbatim source text (source-span verifier)
- Drops unverifiable claims and shows a rejected-claim counter
- Exposes the same context bundle via Rovo MCP tools for AI agents

## Build status

| Step | Description | Status |
|------|-------------|--------|
| 1 | Scaffold with `forge create` | ✅ |
| 2 | Minimal Forge manifest + UI Kit panel | ✅ |
| 3 | `forge lint`, deploy, verify panel in JSM | ✅ |
| 4 | TypeScript conversion + Confluence API verification | ✅ |
| 5 | Rovo MCP hello-world + `get-ticket-context` | ✅ |
| 6–14 | Full pipeline, verifier, MCP tools, TWG, demo | 🔜 |

## Demo site

The app is pre-installed on the Codegeist provisioned demo site with Rovo Enterprise, seeded JSM data, and Confluence knowledge bases.

**Site:** `one-atlas-edlg.atlassian.net` (expires 2027-02-18)

### See the JSM panel

1. Go to [IT Support queue](https://one-atlas-edlg.atlassian.net/jira/servicedesk/projects/ITS/queues/custom/1)
2. Open any ticket (e.g. ITS-6263)
3. The **Outrider** panel appears in the right-side context section

### Test the MCP tool via Rovo Studio

1. Open any Jira page on the demo site and click **Ask Rovo** (top-right)
2. Click the agent selector dropdown → **Create agent** → **Start from blank**
3. Click **+ Add tools** → select **outrider** from Connected apps → select **Get ticket context (development)** → **Add**
4. Click **Test** (top-right) and send: `Use the get-ticket-context tool with ticketKey ITS-6263`
5. The tool returns a `ContextBundle` with `ticketKey`, `builtAt`, and source arrays

> **Note:** The tool currently returns a stub bundle (empty source arrays). Full incident/resolution retrieval is implemented in Step 6.

### View runtime logs

Go to the [Forge developer console](https://developer.atlassian.com/console/myapps/91f15c4b-555e-4db0-99e1-7567c801fc07/monitoring/logs) → Logs tab.

## Requirements

- Node.js 18+
- Forge CLI: `npm install -g @forge/cli`
- Atlassian developer account

## Setup

```
forge login
forge deploy
forge install -p Jira -s <your-site>.atlassian.net -e development
forge install -p Confluence -s <your-site>.atlassian.net -e development
```

**Note:** After adding new scopes, run `forge install --upgrade` separately for each product (Jira and Confluence appear as separate rows).

## Development

```
forge deploy              # deploy changes
forge logs                # tail runtime logs
forge install --upgrade   # apply new scopes to existing installs
```

## Architecture

```
Jira event → Queue → Consumer → ContextBundle → JSM Panel
                                              → Rovo MCP tools
```

