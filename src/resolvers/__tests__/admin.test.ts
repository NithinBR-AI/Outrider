// Settings page resolver tests (spec Phase 5.5). The settings adapter is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ getSettings: vi.fn(), listProjects: vi.fn(), listFields: vi.fn(), listSpaces: vi.fn() }));
vi.mock('@forge/resolver', () => ({ default: class { define() {} getDefinitions() { return {}; } } }));
vi.mock('../../adapters/settings', () => ({ getSettings: h.getSettings, listProjects: h.listProjects, listFields: h.listFields, listSpaces: h.listSpaces, saveSettings: vi.fn() }));

import { loadSettingsPage, SPACES_UNAVAILABLE } from '../admin';
import { AFFECTED_SERVICES_FIELD_TYPE, REQUEST_TYPE_FIELD_TYPE } from '../../domain/settings';

beforeEach(() => {
  h.getSettings.mockReset().mockResolvedValue(undefined);
  h.listSpaces.mockReset().mockResolvedValue({ spaces: [{ key: 'ITO', name: 'IT Operations' }], truncated: false });
  h.listProjects.mockReset().mockResolvedValue({ projects: [{ key: 'ITS', name: 'IT Support' }], truncated: false });
  h.listFields.mockReset().mockResolvedValue([
    { id: 'customfield_10039', name: 'Affected services', schema: { custom: AFFECTED_SERVICES_FIELD_TYPE } },
    { id: 'customfield_10010', name: 'Request Type', schema: { custom: REQUEST_TYPE_FIELD_TYPE } },
    { id: 'customfield_10027', name: 'Request participants', schema: { custom: 'com.atlassian.servicedesk:sd-request-participants' } },
  ]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('loadSettingsPage', () => {
  it('on a site that is not set up: no settings, the projects, the spaces, and the detected fields', async () => {
    expect(await loadSettingsPage()).toEqual({
      ok: true,
      spaces: [{ key: 'ITO', name: 'IT Operations' }],
      settings: undefined,
      projects: [{ key: 'ITS', name: 'IT Support' }],
      projectsTruncated: false,
      fieldOptions: {
        affectedServices: [{ id: 'customfield_10039', name: 'Affected services' }],
        requestType: [{ id: 'customfield_10010', name: 'Request Type' }],
      },
      detected: { affectedServicesField: 'customfield_10039', requestTypeField: 'customfield_10010' },
    });
  });

  it('includes the saved settings when there are some', async () => {
    h.getSettings.mockResolvedValue({ bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'] });
    expect(await loadSettingsPage()).toMatchObject({ ok: true, settings: { bundleProjects: ['ITS'], sourceProjects: ['ITS', 'ITO'] } });
  });

  it('still loads when Confluence spaces cannot be listed, and says why', async () => {
    h.listSpaces.mockRejectedValue(new Error('confluence-spaces-404'));
    const r = await loadSettingsPage();
    expect(r).toMatchObject({ ok: true, spaces: [], spacesError: SPACES_UNAVAILABLE, projects: [{ key: 'ITS', name: 'IT Support' }] });
  });

  it('returns a plain message when Jira cannot be read', async () => {
    h.listProjects.mockRejectedValue(new Error('jira-projects-503'));
    expect(await loadSettingsPage()).toEqual({ ok: false, message: 'Outrider could not read projects and fields from Jira just now. Reload the page to try again.' });
  });
});
