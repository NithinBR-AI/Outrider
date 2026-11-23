// Teams involved (step 11, Teamwork Graph). Pure: no Forge imports, no I/O.
//
// Agreed design (2026-11-22, a deliberate alternative to spec §11.6's stored ServiceLink):
// - Read time only, as the viewer. Probed on the demo site: Teamwork Graph calls fail in the queue consumer
//   (asUser(): 401 AUTH_TYPE_UNAVAILABLE; asUser(accountId): 401 NO_IMPERSONATION_SCOPES_DEFINED) and work
//   from the panel resolver and the MCP action. Nothing is stored, so there is nothing to re-authorize.
// - The relationship is "team linked to the Jira space (project) of a related incident", from the curated
//   query atlassianTeamsBySpace. Assignee-to-teams was rejected: every demo-site assignee with teams is in 9
//   to 18 of them, so it could not say which team is involved.
// - Teams come only from incidents the viewer can already see, so a viewer without access to a project
//   learns nothing about its teams, and no Teamwork Graph call is made for them.
import { Incident } from './types';

// Teams shown per bundle, the same limit as other sections (§3.2).
export const MAX_TEAMS = 5;
// Distinct projects looked up per read. Incidents arrive ranked, so these are the most relevant ones.
export const MAX_TEAM_PROJECTS = 5;
// Failure recorded when every Teamwork Graph lookup failed or ran out of time (§11.4: concise, no details).
export const TWG_UNAVAILABLE = 'twg:unavailable';
// Failure recorded when some projects answered and others did not (added 2026-11-23): the teams that were found
// are shown, with a note that some could not be checked, so a missing team is never read as "none linked".
export const TWG_PARTIAL = 'twg:partial';

/** The failure to record for a teams lookup: none, some projects unanswered, or all of them. */
export function teamsFailure(lookedUp: number, failed: number): string | undefined {
  if (failed <= 0) return undefined;
  return failed >= lookedUp ? TWG_UNAVAILABLE : TWG_PARTIAL;
}

const PROJECT_OF_KEY = /^([A-Z][A-Z0-9_]+)-\d+$/;

/** A team linked to the project of a related incident, as one viewer may see it. Never stored. */
export type TeamLink = {
  teamId: string;
  name: string;
  // Team profile page; empty if Teamwork Graph gave none or it was not an https link.
  url: string;
  projectKey: string;
  // The highest-ranked related incident in that project, the evidence for showing the team.
  incidentKey: string;
  evidence: string;
};

/** A team as Teamwork Graph returns it (atlassianTeamsBySpace). */
export type GraphTeam = { id: string; name: string; url?: string };

/**
 * The distinct projects of the related incidents, in ranked order, each with its highest-ranked incident.
 * Only Jira incidents with a valid issue key count; at most MAX_TEAM_PROJECTS.
 */
export function incidentProjects(incidents: Incident[]): { projectKey: string; incidentKey: string }[] {
  const out: { projectKey: string; incidentKey: string }[] = [];
  const seen = new Set<string>();
  for (const i of incidents ?? []) {
    if (i?.source?.kind !== 'jira-issue') continue;
    const m = PROJECT_OF_KEY.exec(i.source.id);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ projectKey: m[1], incidentKey: i.source.id });
    if (out.length === MAX_TEAM_PROJECTS) break;
  }
  return out;
}

/** The evidence line shown under a team (panel) and returned with it (MCP). */
export function teamEvidence(projectKey: string, incidentKey: string): string {
  return `Linked to the ${projectKey} project, where ${incidentKey} is tracked`;
}

/**
 * One list of teams across all looked-up projects: in project order, each team once (its first project
 * gives the evidence), at most MAX_TEAMS. Teams without an ID or name are skipped.
 */
export function mergeTeams(perProject: { projectKey: string; incidentKey: string; teams: GraphTeam[] }[]): TeamLink[] {
  const out: TeamLink[] = [];
  const seen = new Set<string>();
  for (const p of perProject) {
    for (const t of p.teams) {
      if (!t.id || !t.name || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push({
        teamId: t.id,
        name: t.name,
        url: typeof t.url === 'string' && t.url.startsWith('https://') ? t.url : '',
        projectKey: p.projectKey,
        incidentKey: p.incidentKey,
        evidence: teamEvidence(p.projectKey, p.incidentKey),
      });
      if (out.length === MAX_TEAMS) return out;
    }
  }
  return out;
}
