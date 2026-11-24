# Outrider: terms of use and data handling

Last updated: 2026-11-24

These terms apply when you install or use Outrider, a Forge app for Jira Service Management and Confluence. They
also describe exactly what data Outrider reads, stores and sends, because this page is linked from the app's
listing as both its terms and its data notice. The [README](README.md) explains how the app works in more detail.

## 1. Who provides Outrider

Outrider is built and maintained by Nithin Ramesh, an individual developer, as an entry to Atlassian Codegeist
2026. It is not made, endorsed or supported by Atlassian. There is no paid plan, no service level agreement and no
guaranteed availability.

## 2. Licence and no warranty

Outrider's code is released under the [MIT licence](LICENSE). The app is provided **as is, without warranty of any
kind**, express or implied, including fitness for a particular purpose. To the extent the law allows, the
maintainer is not liable for any loss or damage arising from using it. You use it at your own risk.

Outrider's summaries are matched word for word to their sources, but a match proves only that the source says it,
not that it is true or current. Check the source before acting on anything Outrider shows.

## 3. What you decide as the site admin

A Jira admin chooses, on Outrider's settings page, which projects get context, which projects and Confluence spaces
are searched, which fields are used, and whether request clustering uses Components. Outrider does nothing on a
site until those settings are saved. You are responsible for choosing projects and spaces whose content may be
processed as described below.

## 4. What Outrider reads

Outrider reads, through Atlassian's APIs and with the permissions shown on the install screen:

- Jira tickets in the projects you chose: summary, description, status, dates, request type, Affected services,
  Components and comments (for how a resolved ticket was fixed).
- Confluence pages in the spaces you chose.
- Teams linked to Jira projects, from Teamwork Graph, looked up as the person viewing the panel.

It never writes to Jira or Confluence: it creates, edits and deletes nothing there.

## 5. What Outrider stores

Everything below is kept in Forge hosted storage, which Atlassian runs for the app, separately for each site and
environment. Outrider has no database or server of its own.

| What | Contents | How long |
|---|---|---|
| Context bundle, one per ticket | Links to related incidents, resolved tickets and pages; their titles; short excerpts (up to 600 characters each); the generated summary claims; a SHA-256 fingerprint of the ticket fields used for retrieval | Until the ticket's next build replaces it. If its project is removed from the settings, it is kept but no longer shown. |
| Build status, one per ticket | Build ID, times, state and what started it ("Jira event" or "Rovo request") | Until the next build replaces it |
| Locks | Short leases that stop two builds or passes running at once | Expire after 11 minutes |
| Emerging-incident records | Service and component IDs and names, the keys of the requests in the signal, its time window and state | Deleted 7 days after the window ends |
| Site settings | The projects, spaces, field IDs, clustering window and threshold you chose | Until changed |

**Not stored:** Atlassian account IDs, names or emails from user profiles; full ticket descriptions or full page
bodies; teams; anything sent to or received from the services in section 6 beyond the summary claims.

**Personal data in stored excerpts.** Excerpts are kept as written in Jira or Confluence, so they can contain a
person's name if someone typed it into a ticket or page (for example a comment that begins "Hello Emma"). Outrider
does not identify, index or report people from this text.

## 6. Data sent outside Atlassian

Outrider calls two services outside Atlassian. Both domains are listed on the install screen.

| Service | Domain | Used for |
|---|---|---|
| Amazon Bedrock (AWS, us-east-1) | `bedrock-mantle.us-east-1.api.aws` | Writing the summary claims |
| Jina AI | `api.jina.ai` | Embeddings that rank related items |

- **Sent:** the ticket's summary and description, and the titles and stored excerpts of its related incidents,
  resolved tickets and pages. Emails and links are replaced with placeholders first.
- **Not sent:** account IDs, user fields such as reporter or assignee, ticket keys, page IDs, or links to Jira or
  Confluence. Text inside a ticket is otherwise sent as written, so a name typed into a description is included.
- **When:** only while building context after a ticket changes. Bedrock is called only when that content changed;
  Jina once per build. Neither is called when someone opens the panel or asks Rovo.
- **Training:** Jina states that it never uses API inputs or outputs to train its models. Amazon Bedrock does not
  use inputs to train models.
- **Credentials:** the maintainer's own Amazon Bedrock and Jina API keys, stored as encrypted Forge environment
  variables. You do not provide any keys.

## 7. Who can see what

Outrider gathers context with the app's own access, then filters it for each person on every read: a viewer only
sees tickets, pages and teams they can already open themselves. A failed permission check shows nothing. Rovo
agents get the same filtered context for whoever is asking.

## 8. Logs

Forge keeps the app's runtime logs, which the maintainer can read to fix problems. Outrider's log lines contain
ticket keys, project keys, counts, timings and error messages, not ticket text or user details. A site or org admin
can turn off the maintainer's access to these logs, or view and download them, from Atlassian Administration.

## 9. Removing your data

- **Stop showing context for a project:** remove it on the settings page.
- **Remove everything:** uninstall Outrider from Jira and Confluence. Atlassian keeps Forge hosted storage for 28
  days after uninstalling and then deletes it. Reinstalling does not restore it.
- Data already sent to Amazon Bedrock or Jina for a summary or a ranking is subject to those services' own terms.

## 10. Changes and contact

These terms may change as the app changes; the date at the top shows the latest version, and the history is in
this repository. Questions, problems or requests: open an issue at
[github.com/NithinBR-AI/Outrider/issues](https://github.com/NithinBR-AI/Outrider/issues).
