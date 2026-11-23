// Open requests for a clustering pass (step 13, spec §14.1, §14.2), read AS THE APP.
//
// Verified on the demo site (2026-11-23):
// - Affected services values are [{ id: "ari:cloud:graph::service/<site>/<service>" }]; the display name only
//   comes with expand=renderedFields ([{ id, name: "Infrastructure Services" }]).
// - Components values are [{ id: "10014", name: "VPN Server" }] (16 components in ITS).
// - Assets object values could not be read by the demo user (the field came back []), so Components is the only
//   entity field accepted (domain/settings.ts).
// Only structured IDs are read; summaries and descriptions are never used for identity.
import api, { route } from '@forge/api';
import { ClusterRequest } from '../domain/cluster';
import { entityKindOf, PROJECT_KEY } from '../domain/settings';

// Requests per pass. A project with more open requests inside one window than this is clustered on the newest.
export const MAX_CLUSTER_REQUESTS = 200;
const PAGE = 100;

type Value = { id?: unknown; name?: unknown };
type Issue = { key: string; fields: Record<string, unknown>; renderedFields?: Record<string, unknown> };

const values = (v: unknown): Value[] => (Array.isArray(v) ? v.filter((x): x is Value => !!x && typeof x === 'object') : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);

export type ClusterSourceResult = { requests: ClusterRequest[]; serviceNames: Map<string, string>; entityNames: Map<string, string> };

/**
 * Open requests in one project created within the last lookbackMinutes, with their structured identity.
 * Display names are returned separately for the signal card; they never take part in matching (§14.4).
 */
export async function openRequestsForClustering(
  projectKey: string,
  settings: { affectedServicesField?: string; clusterEntityField?: string },
  lookbackMinutes: number,
): Promise<ClusterSourceResult> {
  if (!PROJECT_KEY.test(projectKey)) throw new Error('cluster-bad-project');
  const serviceField = settings.affectedServicesField;
  const entityField = settings.clusterEntityField;
  const fields = ['created', serviceField, entityField].filter((f): f is string => !!f);
  const jql = `project = ${projectKey} AND statusCategory != Done AND created >= -${Math.ceil(lookbackMinutes)}m ORDER BY created DESC`;

  const issues: Issue[] = [];
  let nextPageToken: string | undefined;
  do {
    const res = await api.asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jql, fields, expand: 'renderedFields', maxResults: Math.min(PAGE, MAX_CLUSTER_REQUESTS - issues.length), ...(nextPageToken ? { nextPageToken } : {}) }),
    });
    if (!res.ok) throw new Error(`cluster-search-${res.status}`);
    const data = (await res.json()) as { issues?: Issue[]; nextPageToken?: string };
    issues.push(...(data.issues ?? []));
    nextPageToken = data.nextPageToken;
  } while (nextPageToken && issues.length < MAX_CLUSTER_REQUESTS);

  const serviceNames = new Map<string, string>();
  const entityNames = new Map<string, string>();
  const requests = issues.map((issue): ClusterRequest => {
    const serviceIds: string[] = [];
    if (serviceField) {
      const rendered = values(issue.renderedFields?.[serviceField]);
      for (const v of values(issue.fields[serviceField])) {
        const id = str(v.id);
        if (!id) continue;
        serviceIds.push(id);
        const name = str(rendered.find((r) => str(r.id) === id)?.name);
        if (name) serviceNames.set(id.toLowerCase(), name);
      }
    }
    const entities: ClusterRequest['entities'] = [];
    if (entityField) {
      for (const v of values(issue.fields[entityField])) {
        const id = str(v.id);
        if (!id) continue;
        entities.push({ kind: entityKindOf(entityField), id });
        const name = str(v.name);
        if (name) entityNames.set(id.toLowerCase(), name);
      }
    }
    return { key: issue.key, createdAt: str(issue.fields.created) ?? '', serviceIds, entities };
  });
  return { requests, serviceNames, entityNames };
}
