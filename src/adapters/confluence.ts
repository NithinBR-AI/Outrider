import api, { route, asApp } from '@forge/api';

/**
 * Fetches a list of Confluence spaces to verify the API connection.
 * Returns the name of the first space found, or 'no spaces' if empty.
 */
export async function fetchConfluencePage(): Promise<string> {
  const res = await api
    .asApp()
    .requestConfluence(route`/wiki/api/v2/spaces?limit=1`, {
      headers: { Accept: 'application/json' },
    });

  if (!res.ok) {
    throw new Error(`Confluence API error: ${res.status}`);
  }

  const data = await res.json() as { results?: Array<{ name: string }> };
  const first = data.results?.[0];
  return first ? first.name : 'no spaces found (v2)';
}
