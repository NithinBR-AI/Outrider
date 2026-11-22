// Per-site settings storage and validation (spec Phase 5.5).
//
// - Stored in Forge KVS under one key. Configuration, not credentials, so not secret storage.
// - Read once per invocation by each entry point (event handler, build job, panel, MCP tools) and passed
//   down; nothing caches settings across invocations, so a save takes effect on the next invocation.
// - Validation on save runs as the app: every project must exist and be visible to Outrider, and every
//   field ID must be an existing field. On any failure the previous settings stay in effect.
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { JiraField, parseSettings, SettingsInput, SiteSettings, SPACE_KEY } from '../domain/settings';

export const SETTINGS_KEY = 'settings:site';
// Project list paging for the admin page. Sites with more projects than this show the first ones only.
const PROJECT_PAGE_SIZE = 50;
export const MAX_LISTED_PROJECTS = 500;

type StoredSettings = SiteSettings & { savedAt: string };

/** The saved settings, or undefined when the site is not set up. */
export async function getSettings(): Promise<SiteSettings | undefined> {
  const stored = (await kvs.get(SETTINGS_KEY)) as StoredSettings | undefined;
  if (!stored || !Array.isArray(stored.bundleProjects) || !Array.isArray(stored.sourceProjects)) return undefined;
  const { savedAt: _savedAt, ...settings } = stored;
  return settings;
}

export type ProjectOption = { key: string; name: string };

/** Projects Outrider can see, for the admin page's project choice. */
export async function listProjects(): Promise<{ projects: ProjectOption[]; truncated: boolean }> {
  const projects: ProjectOption[] = [];
  for (let startAt = 0; startAt < MAX_LISTED_PROJECTS; startAt += PROJECT_PAGE_SIZE) {
    const res = await api.asApp().requestJira(route`/rest/api/3/project/search?startAt=${startAt}&maxResults=${PROJECT_PAGE_SIZE}&orderBy=key`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`jira-projects-${res.status}`);
    const data = (await res.json()) as { values?: { key?: string; name?: string }[]; isLast?: boolean };
    for (const p of data.values ?? []) if (p.key) projects.push({ key: p.key, name: p.name ?? p.key });
    if (data.isLast !== false || (data.values ?? []).length === 0) return { projects, truncated: false };
  }
  return { projects, truncated: true };
}

export type SpaceOption = { key: string; name: string };

/**
 * Global Confluence spaces Outrider can see, for the settings page. The app sees only spaces it is a member
 * of (verified on the demo site), so a missing space means Outrider has not been added to it.
 */
export async function listSpaces(): Promise<{ spaces: SpaceOption[]; truncated: boolean }> {
  const spaces: SpaceOption[] = [];
  let cursor: string | undefined;
  for (let page = 0; page * 50 < MAX_LISTED_PROJECTS; page++) {
    const res = cursor
      ? await api.asApp().requestConfluence(route`/wiki/api/v2/spaces?type=global&limit=50&cursor=${cursor}`, { headers: { Accept: 'application/json' } })
      : await api.asApp().requestConfluence(route`/wiki/api/v2/spaces?type=global&limit=50`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`confluence-spaces-${res.status}`);
    const data = (await res.json()) as { results?: { key?: string; name?: string }[]; _links?: { next?: string } };
    for (const s of data.results ?? []) if (s.key && SPACE_KEY.test(s.key)) spaces.push({ key: s.key, name: s.name ?? s.key });
    const next = data._links?.next ? new URL(data._links.next, 'https://x').searchParams.get('cursor') ?? undefined : undefined;
    if (!next) return { spaces, truncated: false };
    cursor = next;
  }
  return { spaces, truncated: true };
}

/** The keys among `keys` that exist and that Outrider can see. */
async function visibleSpaceKeys(keys: string[]): Promise<Set<string>> {
  const res = await api.asApp().requestConfluence(route`/wiki/api/v2/spaces?keys=${keys.join(',')}&limit=${keys.length}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`confluence-spaces-${res.status}`);
  const data = (await res.json()) as { results?: { key?: string }[] };
  return new Set((data.results ?? []).map((s) => s.key ?? ''));
}

/** All Jira fields with their types, for detection and validation. */
export async function listFields(): Promise<JiraField[]> {
  const res = await api.asApp().requestJira(route`/rest/api/3/field`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`jira-fields-${res.status}`);
  return (await res.json()) as JiraField[];
}

/** True if Outrider can see the project. */
async function projectExists(key: string): Promise<boolean> {
  const res = await api.asApp().requestJira(route`/rest/api/3/project/${key}`, { headers: { Accept: 'application/json' } });
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`jira-project-${res.status}`);
  return true;
}

export type SaveResult = { ok: true; settings: SiteSettings } | { ok: false; message: string };

/**
 * Validates and saves settings. Nothing is written unless every check passes, so a rejected save leaves the
 * previous settings in effect. Messages name the problem; they never include stack traces or response bodies.
 */
export async function saveSettings(input: SettingsInput, now: Date = new Date()): Promise<SaveResult> {
  const parsed = parseSettings(input);
  if ('error' in parsed) return { ok: false, message: parsed.error };
  const { settings } = parsed;
  try {
    const keys = [...new Set([...settings.bundleProjects, ...settings.sourceProjects])];
    for (const key of keys) {
      if (!(await projectExists(key))) return { ok: false, message: `Project ${key} doesn't exist or Outrider can't see it.` };
    }
    const spaces = settings.confluenceSpaces ?? [];
    if (spaces.length > 0) {
      const visible = await visibleSpaceKeys(spaces);
      const missing = spaces.find((k) => !visible.has(k));
      if (missing) return { ok: false, message: `Confluence space ${missing} doesn't exist or Outrider can't see it. Add Outrider as a member of that space, then try again.` };
    }
    const wanted = [settings.affectedServicesField, settings.requestTypeField].filter((f): f is string => !!f);
    if (wanted.length > 0) {
      const ids = new Set((await listFields()).map((f) => f.id));
      const missing = wanted.find((id) => !ids.has(id));
      if (missing) return { ok: false, message: `Field ${missing} doesn't exist on this site.` };
    }
  } catch (err) {
    console.error('settings validation failed', err);
    return { ok: false, message: 'Jira could not be checked just now. Nothing was saved; try again.' };
  }
  const stored: StoredSettings = { ...settings, savedAt: now.toISOString() };
  await kvs.set(SETTINGS_KEY, stored);
  return { ok: true, settings };
}
