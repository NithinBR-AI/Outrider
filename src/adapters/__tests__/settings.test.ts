// Settings storage and validation tests (spec Phase 5.5). KVS and Jira are mocked (§19.7).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  calls: [] as string[],
  handler: null as null | ((path: string) => { status: number; json?: unknown }),
}));

vi.mock('@forge/kvs', () => ({
  kvs: {
    get: async (key: string) => h.store.get(key),
    set: async (key: string, value: unknown) => void h.store.set(key, value),
  },
}));
vi.mock('@forge/api', () => ({
  route: (s: TemplateStringsArray, ...v: unknown[]) => s.reduce((a, x, i) => a + x + (i < v.length ? String(v[i]) : ''), ''),
  default: {
    asApp: () => ({
      requestJira: async (path: string) => {
        h.calls.push(path);
        const r = h.handler!(path);
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
      },
    }),
  },
}));

import { getSettings, listFields, listProjects, MAX_LISTED_PROJECTS, saveSettings, SETTINGS_KEY } from '../settings';

// A site with projects SUP and INC and the two JSM fields.
const site = (path: string) => {
  if (path === '/rest/api/3/project/SUP' || path === '/rest/api/3/project/INC') return { status: 200, json: {} };
  if (path.startsWith('/rest/api/3/project/')) return { status: 404 };
  if (path === '/rest/api/3/field') return { status: 200, json: [{ id: 'customfield_10039' }, { id: 'customfield_10010' }, { id: 'summary' }] };
  return { status: 500 };
};
const VALID = { bundleProjects: ['sup'], sourceProjects: ['SUP', 'INC'], affectedServicesField: 'customfield_10039', requestTypeField: 'customfield_10010' };

beforeEach(() => {
  h.store.clear();
  h.calls = [];
  h.handler = site;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getSettings', () => {
  it('is undefined when nothing is saved, or the stored value is malformed', async () => {
    expect(await getSettings()).toBeUndefined();
    h.store.set(SETTINGS_KEY, { bundleProjects: 'ITS' });
    expect(await getSettings()).toBeUndefined();
  });

  it('returns the saved settings without bookkeeping fields', async () => {
    h.store.set(SETTINGS_KEY, { bundleProjects: ['SUP'], sourceProjects: ['SUP'], savedAt: 't' });
    expect(await getSettings()).toEqual({ bundleProjects: ['SUP'], sourceProjects: ['SUP'] });
  });
});

describe('saveSettings', () => {
  it('saves valid settings, normalized, with a timestamp, and they read back', async () => {
    const r = await saveSettings(VALID, new Date('2026-11-21T00:00:00Z'));
    expect(r).toEqual({ ok: true, settings: { ...VALID, bundleProjects: ['SUP'] } });
    expect(h.store.get(SETTINGS_KEY)).toEqual({ ...VALID, bundleProjects: ['SUP'], savedAt: '2026-11-21T00:00:00.000Z' });
    expect(await getSettings()).toEqual({ ...VALID, bundleProjects: ['SUP'] });
  });

  it('rejects a bad shape before calling Jira', async () => {
    expect(await saveSettings({ bundleProjects: [], sourceProjects: ['SUP'] })).toEqual({ ok: false, message: 'Choose at least one project whose tickets get context.' });
    expect(h.calls).toEqual([]);
  });

  it('rejects an unknown project by name, and keeps the previous settings', async () => {
    h.store.set(SETTINGS_KEY, { bundleProjects: ['OLD'], sourceProjects: ['OLD'], savedAt: 'before' });
    expect(await saveSettings({ ...VALID, sourceProjects: ['SUP', 'NOPE'] })).toEqual({ ok: false, message: "Project NOPE doesn't exist or Outrider can't see it." });
    expect(h.store.get(SETTINGS_KEY)).toEqual({ bundleProjects: ['OLD'], sourceProjects: ['OLD'], savedAt: 'before' });
  });

  it('rejects an unknown field by ID', async () => {
    expect(await saveSettings({ ...VALID, requestTypeField: 'customfield_99999' })).toEqual({ ok: false, message: "Field customfield_99999 doesn't exist on this site." });
    expect(h.store.has(SETTINGS_KEY)).toBe(false);
  });

  it('checks each project once and skips the field list when no field is set', async () => {
    await saveSettings({ bundleProjects: ['SUP'], sourceProjects: ['SUP'] });
    expect(h.calls).toEqual(['/rest/api/3/project/SUP']);
  });

  it('saves nothing when Jira cannot be checked, with a message that leaks nothing', async () => {
    h.handler = () => ({ status: 503 });
    const r = await saveSettings(VALID);
    expect(r).toEqual({ ok: false, message: 'Jira could not be checked just now. Nothing was saved; try again.' });
    expect(h.store.has(SETTINGS_KEY)).toBe(false);
  });
});

describe('listProjects', () => {
  it('pages through the projects Outrider can see', async () => {
    h.handler = (path) => {
      const start = Number(/startAt=(\d+)/.exec(path)![1]);
      const values = start === 0 ? Array.from({ length: 50 }, (_, n) => ({ key: `P${n}`, name: `Project ${n}` })) : [{ key: 'LAST' }];
      return { status: 200, json: { values, isLast: start > 0 } };
    };
    const r = await listProjects();
    expect(r.projects).toHaveLength(51);
    expect(r.projects[50]).toEqual({ key: 'LAST', name: 'LAST' });
    expect(r.truncated).toBe(false);
    expect(h.calls).toHaveLength(2);
  });

  it('stops at the listing limit and says so', async () => {
    h.handler = () => ({ status: 200, json: { values: Array.from({ length: 50 }, (_, n) => ({ key: `P${n}`, name: 'x' })), isLast: false } });
    const r = await listProjects();
    expect(r.projects).toHaveLength(MAX_LISTED_PROJECTS);
    expect(r.truncated).toBe(true);
  });

  it('stops on an empty page and skips entries without a key', async () => {
    h.handler = () => ({ status: 200, json: { values: [], isLast: false } });
    expect(await listProjects()).toEqual({ projects: [], truncated: false });
    h.handler = () => ({ status: 200, json: { values: [{ name: 'no key' }] } });
    expect((await listProjects()).projects).toEqual([]);
  });

  it('throws a short code on failure', async () => {
    h.handler = () => ({ status: 500 });
    await expect(listProjects()).rejects.toThrow('jira-projects-500');
    await expect(listFields()).rejects.toThrow('jira-fields-500');
  });
});
