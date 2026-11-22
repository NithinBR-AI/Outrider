// Per-site settings rules (spec Phase 5.5). Pure.
import { describe, expect, it } from 'vitest';
import {
  AFFECTED_SERVICES_FIELD_TYPE,
  detectFields,
  fieldsOfType,
  isBundleTicket,
  MAX_PROJECTS,
  NOT_SET_UP_MESSAGE,
  parseSettings,
  REQUEST_TYPE_FIELD_TYPE,
} from '../settings';

describe('parseSettings', () => {
  it('normalizes project keys: trimmed, upper-cased, de-duplicated, empty entries dropped', () => {
    expect(parseSettings({ bundleProjects: [' sup ', 'SUP', ''], sourceProjects: ['sup', 'inc', 7, null] })).toEqual({
      settings: { bundleProjects: ['SUP'], sourceProjects: ['SUP', 'INC'] },
    });
  });

  it('keeps field IDs when given and leaves them out when empty', () => {
    expect(parseSettings({ bundleProjects: ['ITS'], sourceProjects: ['ITS'], affectedServicesField: ' customfield_10039 ', requestTypeField: '' })).toEqual({
      settings: { bundleProjects: ['ITS'], sourceProjects: ['ITS'], affectedServicesField: 'customfield_10039' },
    });
  });

  it('requires at least one project in each list', () => {
    expect(parseSettings({ bundleProjects: [], sourceProjects: ['ITS'] })).toEqual({ error: 'Choose at least one project whose tickets get context.' });
    expect(parseSettings({ bundleProjects: ['ITS'] })).toEqual({ error: 'Choose at least one project to search for incidents and past resolutions.' });
    expect(parseSettings(undefined)).toMatchObject({ error: expect.any(String) });
    expect(parseSettings({ bundleProjects: 'ITS', sourceProjects: 'ITS' })).toMatchObject({ error: expect.any(String) });
  });

  it('rejects anything that is not a project key, naming it', () => {
    expect(parseSettings({ bundleProjects: ['ITS) OR project = X'], sourceProjects: ['ITS'] })).toEqual({ error: 'Projects that get context: "ITS) OR PROJECT = X" is not a Jira project key.' });
    expect(parseSettings({ bundleProjects: ['ITS'], sourceProjects: ['1AB'] })).toEqual({ error: 'Projects to search: "1AB" is not a Jira project key.' });
  });

  it('caps each list', () => {
    const many = Array.from({ length: MAX_PROJECTS + 1 }, (_, n) => `P${n}A`);
    expect(parseSettings({ bundleProjects: many, sourceProjects: ['ITS'] })).toEqual({ error: `Projects that get context: choose at most ${MAX_PROJECTS} projects.` });
  });

  it('rejects a field value that is not a custom field ID, naming it', () => {
    expect(parseSettings({ bundleProjects: ['ITS'], sourceProjects: ['ITS'], affectedServicesField: 'summary' })).toEqual({ error: 'Affected services field: "summary" is not a custom field ID.' });
    expect(parseSettings({ bundleProjects: ['ITS'], sourceProjects: ['ITS'], requestTypeField: 'customfield_x' })).toEqual({ error: 'Request type field: "customfield_x" is not a custom field ID.' });
  });
});

describe('field detection', () => {
  // Shapes as returned by GET /rest/api/3/field on the demo site.
  const fields = [
    { id: 'summary', name: 'Summary' },
    { id: 'customfield_10027', name: 'Request participants', schema: { custom: 'com.atlassian.servicedesk:sd-request-participants' } },
    { id: 'customfield_10039', name: 'Affected services', schema: { custom: AFFECTED_SERVICES_FIELD_TYPE } },
    { id: 'customfield_10010', name: 'Request Type', schema: { custom: REQUEST_TYPE_FIELD_TYPE } },
    { id: 'customfield_20000', name: 'Second services field', schema: { custom: AFFECTED_SERVICES_FIELD_TYPE } },
  ];

  it('detects each field by its type: the first field of that type', () => {
    expect(detectFields(fields)).toEqual({ affectedServicesField: 'customfield_10039', requestTypeField: 'customfield_10010' });
  });

  it('detects nothing on a site without the fields', () => {
    expect(detectFields([{ id: 'summary' }])).toEqual({ affectedServicesField: undefined, requestTypeField: undefined });
    expect(detectFields(undefined as never)).toEqual({ affectedServicesField: undefined, requestTypeField: undefined });
  });

  it('lists every field of a type, for the override choice, and only custom fields', () => {
    expect(fieldsOfType(fields, AFFECTED_SERVICES_FIELD_TYPE).map((f) => f.id)).toEqual(['customfield_10039', 'customfield_20000']);
    expect(fieldsOfType([{ id: 'odd', schema: { custom: REQUEST_TYPE_FIELD_TYPE } }], REQUEST_TYPE_FIELD_TYPE)).toEqual([]);
  });

  it('ignores malformed entries in the field list', () => {
    const odd = [null, { schema: { custom: REQUEST_TYPE_FIELD_TYPE } }, { id: 'customfield_1', schema: { custom: REQUEST_TYPE_FIELD_TYPE } }] as never;
    expect(fieldsOfType(odd, REQUEST_TYPE_FIELD_TYPE).map((f) => f.id)).toEqual(['customfield_1']);
  });
});

describe('isBundleTicket', () => {
  const settings = { bundleProjects: ['SUP'], sourceProjects: ['SUP', 'INC'] };

  it('is true only for tickets in a bundle project', () => {
    expect(isBundleTicket(settings, 'SUP-12')).toBe(true);
    expect(isBundleTicket(settings, 'INC-3')).toBe(false); // searched, but gets no bundle
    expect(isBundleTicket(settings, 'ITS-6265')).toBe(false);
  });

  it('is false for every ticket when the site is not set up', () => {
    expect(isBundleTicket(undefined, 'SUP-12')).toBe(false);
  });

  it('the not-set-up message is the one the spec gives', () => {
    expect(NOT_SET_UP_MESSAGE).toBe("Outrider isn't set up for this project yet. Ask a Jira admin to configure it.");
  });
});

describe('Confluence spaces setting (step 10)', () => {
  it('is optional, normalized like project keys, and left out when empty', () => {
    expect(parseSettings({ bundleProjects: ['ITS'], sourceProjects: ['ITS'], confluenceSpaces: [' ito ', 'ITO', 'kb'] })).toEqual({
      settings: { bundleProjects: ['ITS'], sourceProjects: ['ITS'], confluenceSpaces: ['ITO', 'KB'] },
    });
    expect(parseSettings({ bundleProjects: ['ITS'], sourceProjects: ['ITS'], confluenceSpaces: [] })).toEqual({ settings: { bundleProjects: ['ITS'], sourceProjects: ['ITS'] } });
  });

  it('rejects personal spaces and anything that is not a space key, naming it, and caps the list', () => {
    expect(parseSettings({ bundleProjects: ['ITS'], sourceProjects: ['ITS'], confluenceSpaces: ['~600a7834'] })).toEqual({ error: 'Confluence spaces: "~600A7834" is not a Confluence space key.' });
    expect(parseSettings({ bundleProjects: ['ITS'], sourceProjects: ['ITS'], confluenceSpaces: ['IT O'] })).toMatchObject({ error: expect.stringContaining('"IT O"') });
    const many = Array.from({ length: MAX_PROJECTS + 1 }, (_, n) => `S${n}`);
    expect(parseSettings({ bundleProjects: ['ITS'], sourceProjects: ['ITS'], confluenceSpaces: many })).toEqual({ error: `Confluence spaces: choose at most ${MAX_PROJECTS} spaces.` });
  });
});
