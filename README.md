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
| 5 | Rovo MCP hello-world + `get-ticket-context` | 🔜 |
| 6–14 | Full pipeline, verifier, MCP tools, TWG, demo | 🔜 |

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

See `docs/spec.md` for the full product and technical specification.
