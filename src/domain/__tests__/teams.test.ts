// Teams involved (step 11). Pure.
import { describe, expect, it } from 'vitest';
import { incidentProjects, MAX_TEAM_PROJECTS, MAX_TEAMS, mergeTeams, teamEvidence, teamsFailure, TWG_PARTIAL, TWG_UNAVAILABLE } from '../teams';
import { Incident } from '../types';

const incident = (id: string, kind: 'jira-issue' | 'confluence-page' = 'jira-issue'): Incident => ({
  source: { kind, id, url: `https://one-atlas-edlg.atlassian.net/browse/${id}`, title: id, updatedAt: 'u' },
  status: 'active',
  summary: 's',
  relevance: 0.5,
});
const PLATFORM = { id: 'ari:cloud:identity::team/ad3bc097', name: 'Platform Support', url: 'https://home.atlassian.com/o/x/people/team/ad3bc097' };
const NETWORK = { id: 'ari:cloud:identity::team/n1', name: 'Network Support', url: 'https://home.atlassian.com/o/x/people/team/n1' };

describe('incidentProjects', () => {
  it('lists each project once, in ranked order, with its highest-ranked incident', () => {
    expect(incidentProjects([incident('ITO-9647'), incident('ITS-6258'), incident('ITO-9649')])).toEqual([
      { projectKey: 'ITO', incidentKey: 'ITO-9647' },
      { projectKey: 'ITS', incidentKey: 'ITS-6258' },
    ]);
  });

  it('skips anything that is not a Jira issue with a valid key, and handles no incidents', () => {
    expect(incidentProjects([incident('123', 'confluence-page'), incident('not a key'), incident('ito-1')])).toEqual([]);
    expect(incidentProjects([])).toEqual([]);
    expect(incidentProjects(undefined as never)).toEqual([]);
  });

  it('looks up at most MAX_TEAM_PROJECTS projects', () => {
    const many = Array.from({ length: MAX_TEAM_PROJECTS + 2 }, (_v, n) => incident(`P${n}-1`));
    expect(incidentProjects(many)).toHaveLength(MAX_TEAM_PROJECTS);
  });
});

describe('mergeTeams', () => {
  it('gives each team the project and incident that connect it, as evidence', () => {
    expect(mergeTeams([{ projectKey: 'ITO', incidentKey: 'ITO-9647', teams: [PLATFORM] }])).toEqual([
      { teamId: PLATFORM.id, name: 'Platform Support', url: PLATFORM.url, projectKey: 'ITO', incidentKey: 'ITO-9647', evidence: 'Linked to the ITO project, where ITO-9647 is tracked' },
    ]);
    expect(teamEvidence('ITO', 'ITO-9647')).toBe('Linked to the ITO project, where ITO-9647 is tracked');
  });

  it('shows a team linked to several projects once, with the evidence of the first (highest-ranked) project', () => {
    const merged = mergeTeams([
      { projectKey: 'ITO', incidentKey: 'ITO-9647', teams: [PLATFORM] },
      { projectKey: 'NET', incidentKey: 'NET-4', teams: [PLATFORM, NETWORK] },
    ]);
    expect(merged.map((t) => [t.name, t.projectKey])).toEqual([['Platform Support', 'ITO'], ['Network Support', 'NET']]);
  });

  it('keeps a team without an https profile link, with no link', () => {
    const [noUrl, badUrl] = mergeTeams([{ projectKey: 'ITO', incidentKey: 'ITO-1', teams: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', url: 'javascript:alert(1)' }] }]);
    expect(noUrl.url).toBe('');
    expect(badUrl.url).toBe('');
  });

  it('skips teams without an ID or a name, and stops at MAX_TEAMS', () => {
    expect(mergeTeams([{ projectKey: 'ITO', incidentKey: 'ITO-1', teams: [{ id: '', name: 'X' }, { id: 'y', name: '' }] }])).toEqual([]);
    const lots = Array.from({ length: MAX_TEAMS + 3 }, (_v, n) => ({ id: `t${n}`, name: `Team ${n}` }));
    expect(mergeTeams([{ projectKey: 'ITO', incidentKey: 'ITO-1', teams: lots }])).toHaveLength(MAX_TEAMS);
    expect(mergeTeams([])).toEqual([]);
  });

  it('uses the agreed limits and failure code', () => {
    expect(MAX_TEAMS).toBe(5);
    expect(MAX_TEAM_PROJECTS).toBe(5);
    expect(TWG_UNAVAILABLE).toBe('twg:unavailable');
    expect(TWG_PARTIAL).toBe('twg:partial');
  });

  it('records no failure, a partial one, or unavailable, by how many project lookups failed', () => {
    expect(teamsFailure(2, 0)).toBeUndefined();
    expect(teamsFailure(2, 1)).toBe(TWG_PARTIAL);
    expect(teamsFailure(2, 2)).toBe(TWG_UNAVAILABLE);
    expect(teamsFailure(1, 1)).toBe(TWG_UNAVAILABLE);
    expect(teamsFailure(0, 0)).toBeUndefined();
  });
});
