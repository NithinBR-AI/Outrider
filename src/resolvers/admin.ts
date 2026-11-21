// Resolver for the Outrider settings page (jira:adminPage, spec Phase 5.5).
//
// Only Jira admins can open an admin page; that is the platform's guarantee, and no extra server-side
// admin check is added (agreed: it would need a new scope and a major version upgrade for every install).
// Everything here runs as the app: the page lists the projects and fields Outrider itself can see, so an
// admin can only choose projects the app can actually search.
import Resolver from '@forge/resolver';
import { getSettings, listFields, listProjects, ProjectOption, saveSettings, SaveResult } from '../adapters/settings';
import { AFFECTED_SERVICES_FIELD_TYPE, detectFields, fieldsOfType, REQUEST_TYPE_FIELD_TYPE, SettingsInput, SiteSettings } from '../domain/settings';

export type FieldOption = { id: string; name: string };

export type SettingsPageData =
  | {
      ok: true;
      settings?: SiteSettings;
      projects: ProjectOption[];
      projectsTruncated: boolean;
      fieldOptions: { affectedServices: FieldOption[]; requestType: FieldOption[] };
      detected: { affectedServicesField?: string; requestTypeField?: string };
    }
  | { ok: false; message: string };

const toOption = (f: { id: string; name?: string }): FieldOption => ({ id: f.id, name: f.name ?? f.id });

/** Everything the settings page needs in one call. Exported for tests. */
export async function loadSettingsPage(): Promise<SettingsPageData> {
  try {
    const [settings, projectList, fields] = await Promise.all([getSettings(), listProjects(), listFields()]);
    return {
      ok: true,
      settings,
      projects: projectList.projects,
      projectsTruncated: projectList.truncated,
      fieldOptions: {
        affectedServices: fieldsOfType(fields, AFFECTED_SERVICES_FIELD_TYPE).map(toOption),
        requestType: fieldsOfType(fields, REQUEST_TYPE_FIELD_TYPE).map(toOption),
      },
      detected: detectFields(fields),
    };
  } catch (err) {
    console.error('settings page load failed', err);
    return { ok: false, message: 'Outrider could not read projects and fields from Jira just now. Reload the page to try again.' };
  }
}

const resolver = new Resolver();

resolver.define('loadSettings', async (): Promise<SettingsPageData> => loadSettingsPage());

resolver.define('saveSettings', async (req): Promise<SaveResult> => saveSettings((req.payload ?? {}) as SettingsInput));

export const adminResolver = resolver.getDefinitions();
