// Per-site settings (spec Phase 5.5). Pure: no Forge imports, no I/O.
//
// Four settings replace what used to be demo-site constants:
// - bundleProjects: projects whose tickets get a context bundle (was BUNDLE_PROJECTS = ['ITS']).
// - sourceProjects: projects searched for incidents and resolutions (was SOURCE_PROJECTS = ['ITS', 'ITO']).
// - affectedServicesField / requestTypeField: custom field IDs (were customfield_10039 / customfield_10010).
//   Both are optional: a site without them still works; services are then not used for tie-breaking.
// With no settings saved, the app builds nothing and says it isn't set up.

export type SiteSettings = {
  bundleProjects: string[];
  sourceProjects: string[];
  affectedServicesField?: string;
  requestTypeField?: string;
  // Step 10: Confluence spaces searched for knowledge articles. Optional; none means no articles.
  confluenceSpaces?: string[];
};

/** What retrieval needs from the settings (adapters/jira.ts, adapters/confluence.ts). */
export type RetrievalSettings = Pick<SiteSettings, 'sourceProjects' | 'affectedServicesField' | 'requestTypeField' | 'confluenceSpaces'>;

// Jira field types used to detect the two fields (verified on the demo site: exactly one field of each).
export const AFFECTED_SERVICES_FIELD_TYPE = 'com.atlassian.jira.plugins.service-entity:service-entity-field-cftype';
export const REQUEST_TYPE_FIELD_TYPE = 'com.atlassian.servicedesk:vp-origin';

export const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;
// Global Confluence space keys (personal spaces, "~accountId", are never offered or accepted).
export const SPACE_KEY = /^[A-Z][A-Z0-9]*$/;
export const FIELD_ID = /^customfield_\d+$/;
// Upper bound per list. Retrieval puts source projects into one JQL "project in (...)" clause.
export const MAX_PROJECTS = 20;

export const NOT_SET_UP_MESSAGE = "Outrider isn't set up for this project yet. Ask a Jira admin to configure it.";

export type SettingsInput = { bundleProjects?: unknown; sourceProjects?: unknown; affectedServicesField?: unknown; requestTypeField?: unknown; confluenceSpaces?: unknown };

const keyList = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim().toUpperCase()).filter((v) => v.length > 0))] : [];

const fieldId = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/**
 * Normalizes and checks the shape of submitted settings: keys trimmed, upper-cased and de-duplicated,
 * empty field IDs treated as "not used". Existence in Jira is checked separately (adapters/settings.ts).
 */
export function parseSettings(input: SettingsInput | null | undefined): { settings: SiteSettings } | { error: string } {
  const bundleProjects = keyList(input?.bundleProjects);
  const sourceProjects = keyList(input?.sourceProjects);
  if (bundleProjects.length === 0) return { error: 'Choose at least one project whose tickets get context.' };
  if (sourceProjects.length === 0) return { error: 'Choose at least one project to search for incidents and past resolutions.' };
  for (const [label, list] of [['Projects that get context', bundleProjects], ['Projects to search', sourceProjects]] as const) {
    if (list.length > MAX_PROJECTS) return { error: `${label}: choose at most ${MAX_PROJECTS} projects.` };
    const bad = list.find((k) => !PROJECT_KEY.test(k));
    if (bad) return { error: `${label}: "${bad}" is not a Jira project key.` };
  }
  const affectedServicesField = fieldId(input?.affectedServicesField);
  const requestTypeField = fieldId(input?.requestTypeField);
  for (const [label, id] of [['Affected services field', affectedServicesField], ['Request type field', requestTypeField]] as const) {
    if (id && !FIELD_ID.test(id)) return { error: `${label}: "${id}" is not a custom field ID.` };
  }
  const confluenceSpaces = keyList(input?.confluenceSpaces);
  if (confluenceSpaces.length > MAX_PROJECTS) return { error: `Confluence spaces: choose at most ${MAX_PROJECTS} spaces.` };
  const badSpace = confluenceSpaces.find((k) => !SPACE_KEY.test(k));
  if (badSpace) return { error: `Confluence spaces: "${badSpace}" is not a Confluence space key.` };
  const settings: SiteSettings = { bundleProjects, sourceProjects };
  if (affectedServicesField) settings.affectedServicesField = affectedServicesField;
  if (requestTypeField) settings.requestTypeField = requestTypeField;
  if (confluenceSpaces.length > 0) settings.confluenceSpaces = confluenceSpaces;
  return { settings };
}

export type JiraField = { id: string; name?: string; schema?: { custom?: string } };

/** Custom fields of one Jira field type, for detection and for the override choice. */
export function fieldsOfType(fields: JiraField[], type: string): JiraField[] {
  return (fields ?? []).filter((f) => f?.schema?.custom === type && FIELD_ID.test(f.id ?? ''));
}

/** The detected field IDs: the first field of each type, or none. The admin can override either. */
export function detectFields(fields: JiraField[]): { affectedServicesField?: string; requestTypeField?: string } {
  return {
    affectedServicesField: fieldsOfType(fields, AFFECTED_SERVICES_FIELD_TYPE)[0]?.id,
    requestTypeField: fieldsOfType(fields, REQUEST_TYPE_FIELD_TYPE)[0]?.id,
  };
}

/** True if tickets in this ticket's project get a context bundle. No settings means no project does. */
export function isBundleTicket(settings: SiteSettings | undefined, ticketKey: string): boolean {
  if (!settings) return false;
  return settings.bundleProjects.includes(ticketKey.split('-')[0]);
}
