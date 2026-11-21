// Per-site settings storage and validation (spec Phase 5.5).
//
// - Stored in Forge KVS under one key. Configuration, not credentials, so not secret storage.
// - Read once per invocation by each entry point (event handler, build job, panel, MCP tools) and passed
//   down; nothing caches settings across invocations, so a save takes effect on the next invocation.
// - Validation on save runs as the app: every project must exist and be visible to Outrider, and every
//   field ID must be an existing field. On any failure the previous settings stay in effect.
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';
import { JiraField, parseSettings, SettingsInput, SiteSettings } from '../domain/settings';

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
