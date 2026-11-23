// Resolver for the Outrider settings page (jira:adminPage, spec Phase 5.5).
//
// Only Jira admins can open an admin page; that is the platform's guarantee, and no extra server-side
// admin check is added (agreed: it would need a new scope and a major version upgrade for every install).
// Everything here runs as the app: the page lists the projects and fields Outrider itself can see, so an
// admin can only choose projects the app can actually search.
import Resolver from '@forge/resolver';
import { getSettings, listFields, listProjects, listSpaces, ProjectOption, saveSettings, SaveResult, SpaceOption } from '../adapters/settings';
import { AFFECTED_SERVICES_FIELD_TYPE, COMPONENTS_FIELD, detectFields, fieldsOfType, REQUEST_TYPE_FIELD_TYPE, SettingsInput, SiteSettings } from '../domain/settings';

export type FieldOption = { id: string; name: string };

export type SettingsPageData =
  | {
      ok: true;
      settings?: SiteSettings;
      projects: ProjectOption[];
      projectsTruncated: boolean;
      fieldOptions: { affectedServices: FieldOption[]; requestType: FieldOption[]; clusterEntity: FieldOption[] };
      detected: { affectedServicesField?: string; requestTypeField?: string };
      // Confluence is optional: if its spaces cannot be listed (for example Outrider is not installed in
      // Confluence on this site), the rest of the page still works and spacesError says why.
      spaces: SpaceOption[];
      spacesError?: string;
    }
  | { ok: false; message: string };

export const SPACES_UNAVAILABLE =
  'Confluence spaces could not be listed. Knowledge articles need Outrider installed in Confluence on this site. The other settings still work.';

const toOption = (f: { id: string; name?: string }): FieldOption => ({ id: f.id, name: f.name ?? f.id });

/** Everything the settings page needs in one call. Exported for tests. */
export async function loadSettingsPage(): Promise<SettingsPageData> {
  try {
    const [settings, projectList, fields, spaceList] = await Promise.all([
      getSettings(),
      listProjects(),
      listFields(),
      listSpaces().catch((err) => {
        console.error('settings page: Confluence spaces could not be listed', err);
        return null;
      }),
    ]);
    return {
      spaces: spaceList?.spaces ?? [],
      ...(spaceList ? {} : { spacesError: SPACES_UNAVAILABLE }),
      ok: true,
      settings,
      projects: projectList.projects,
      projectsTruncated: projectList.truncated,
      fieldOptions: {
        affectedServices: fieldsOfType(fields, AFFECTED_SERVICES_FIELD_TYPE).map(toOption),
        requestType: fieldsOfType(fields, REQUEST_TYPE_FIELD_TYPE).map(toOption),
        // Step 13: Components only, the entity source verified on the demo site (spec §14.2: component ID).
        clusterEntity: fields.filter((f) => f.id === COMPONENTS_FIELD).map(toOption),
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
