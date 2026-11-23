// Outrider settings page (jira:adminPage, UI Kit). Spec Phase 5.5.
// Admins choose which projects get context and which are searched; the two custom fields are detected
// and can be overridden. Saving is validated by the resolver; a rejected save changes nothing.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, Heading, HelperMessage, Icon, Inline, Label, LoadingButton, SectionMessage, Select, Spinner, Stack, Text, Textfield, Tooltip } from '@forge/react';
import { invoke } from '@forge/bridge';

const NOT_USED = { label: 'Not used', value: '' };

const projectOption = (p) => ({ label: `${p.name} (${p.key})`, value: p.key });
const fieldOption = (f) => ({ label: `${f.name} (${f.id})`, value: f.id });

/** Options for a field choice: the fields of the right type, plus "Not used", plus a saved value no longer listed. */
function fieldChoices(fields, current) {
  const options = [NOT_USED, ...fields.map(fieldOption)];
  if (current && !fields.some((f) => f.id === current)) options.push({ label: current, value: current });
  return options;
}

const pick = (options, value) => options.find((o) => o.value === value) ?? NOT_USED;

// What each setting is for, shown in a tooltip next to its label. The short text under each field stays,
// because a tooltip is easy to miss. Keep these in line with the README "Set up Outrider" section.
const HELP = {
  bundleProjects: 'The service desks where agents should get help. On every ticket here, Outrider shows related incidents, past fixes, how-to articles and the teams involved. Example: your IT help desk.',
  sourceProjects: 'Where Outrider looks for that help: past and current incidents, and tickets that were already solved. Usually the help desk itself plus the project your operations team logs incidents in.',
  confluenceSpaces: 'The Confluence spaces with your how-to guides and runbooks. Outrider suggests the pages that fit the ticket. People only see pages they are already allowed to open.',
  affectedServicesField: 'The ticket field that says which service is affected, such as Online Sales. Outrider uses it to tell which tickets are about the same thing.',
  requestTypeField: 'The ticket field that says what kind of request it is. Outrider uses it to notice when a ticket has changed enough to refresh its help.',
  clusterEntityField: 'The ticket field that names the affected part of a service, such as VPN Server. When several tickets name the same service and the same part, Outrider is more certain they are about one problem. Choose Not used to group by service only.',
  clusterWindowMinutes: 'How close together, in minutes, the tickets must arrive to count as a possible emerging incident. The warning goes away when this time is up. Leave empty for 90 minutes.',
  clusterThreshold: 'How many open tickets about the same thing it takes before Outrider warns that something bigger may be happening. Leave empty for 5.',
};

/** A field label with an info icon whose tooltip explains the setting. */
const FieldLabel = ({ id, children }) => (
  <Inline space="space.050" alignBlock="center">
    <Label labelFor={id}>{children}</Label>
    <Tooltip content={HELP[id]}>
      <Icon glyph="info" label={`About: ${children}`} size="small" />
    </Tooltip>
  </Inline>
);

const App = () => {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    invoke('loadSettings').then((d) => {
      setData(d);
      if (!d.ok) return;
      const s = d.settings;
      setForm({
        bundleProjects: s?.bundleProjects ?? [],
        sourceProjects: s?.sourceProjects ?? [],
        confluenceSpaces: s?.confluenceSpaces ?? [],
        // Saved values win; otherwise pre-fill what was detected from the site's field types.
        affectedServicesField: s ? s.affectedServicesField ?? '' : d.detected.affectedServicesField ?? '',
        requestTypeField: s ? s.requestTypeField ?? '' : d.detected.requestTypeField ?? '',
        clusterEntityField: s?.clusterEntityField ?? '',
        clusterWindowMinutes: s?.clusterWindowMinutes === undefined ? '' : String(s.clusterWindowMinutes),
        clusterThreshold: s?.clusterThreshold === undefined ? '' : String(s.clusterThreshold),
      });
    });
  }, []);

  if (!data) return <Spinner label="Loading Outrider settings" />;
  if (!data.ok) return <SectionMessage appearance="error"><Text>{data.message}</Text></SectionMessage>;
  if (!form) return null;

  const projectOptions = data.projects.map(projectOption);
  const chosen = (keys) => projectOptions.filter((o) => keys.includes(o.value));
  const spaceOptions = (data.spaces ?? []).map((s) => ({ label: `${s.name} (${s.key})`, value: s.key }));
  // A saved space Outrider can no longer see stays listed, so saving does not silently drop it.
  for (const key of form.confluenceSpaces) if (!spaceOptions.some((o) => o.value === key)) spaceOptions.push({ label: key, value: key });
  const servicesOptions = fieldChoices(data.fieldOptions.affectedServices, form.affectedServicesField);
  const requestOptions = fieldChoices(data.fieldOptions.requestType, form.requestTypeField);
  const entityOptions = fieldChoices(data.fieldOptions.clusterEntity ?? [], form.clusterEntityField);
  const detectedNote = (key, value) => (value && value === data.detected[key] ? 'Detected automatically from this site\'s fields.' : null);

  const save = () => {
    setSaving(true);
    setResult(null);
    invoke('saveSettings', form)
      .then(setResult)
      .catch(() => setResult({ ok: false, message: 'Saving failed. Nothing was changed; try again.' }))
      .finally(() => setSaving(false));
  };

  return (
    <Stack space="space.300">
      <Text>
        Outrider prepares context on tickets: related incidents, past resolutions and a summary whose claims are checked against their sources.
        Choose where it works.
      </Text>
      {!data.settings ? (
        <SectionMessage appearance="information">
          <Text>Outrider isn't set up yet. Until you save these settings it builds nothing, and its panel says it isn't set up.</Text>
        </SectionMessage>
      ) : null}

      <Stack space="space.100">
        <Heading size="small">Projects</Heading>
        <Box>
          <FieldLabel id="bundleProjects">Projects whose tickets get context</FieldLabel>
          <Select inputId="bundleProjects" isMulti options={projectOptions} value={chosen(form.bundleProjects)}
            onChange={(v) => setForm({ ...form, bundleProjects: (v ?? []).map((o) => o.value) })} />
          <HelperMessage>Usually your service desk projects. The Outrider panel shows context on these tickets.</HelperMessage>
        </Box>
        <Box>
          <FieldLabel id="sourceProjects">Projects to search for incidents and past resolutions</FieldLabel>
          <Select inputId="sourceProjects" isMulti options={projectOptions} value={chosen(form.sourceProjects)}
            onChange={(v) => setForm({ ...form, sourceProjects: (v ?? []).map((o) => o.value) })} />
          <HelperMessage>Include the service desk projects and any project where incidents are tracked. Incidents are issues of type [System] Incident.</HelperMessage>
        </Box>
        {data.projectsTruncated ? <Text size="small">Only the first {data.projects.length} projects are listed.</Text> : null}
      </Stack>

      <Stack space="space.100">
        <Heading size="small">Knowledge articles (Confluence)</Heading>
        {data.spacesError ? (
          <SectionMessage appearance="warning"><Text>{data.spacesError}</Text></SectionMessage>
        ) : null}
        <Box>
          <FieldLabel id="confluenceSpaces">Confluence spaces to search for runbooks and articles</FieldLabel>
          <Select inputId="confluenceSpaces" isMulti options={spaceOptions} value={spaceOptions.filter((o) => form.confluenceSpaces.includes(o.value))}
            onChange={(v) => setForm({ ...form, confluenceSpaces: (v ?? []).map((o) => o.value) })} />
          <HelperMessage>
            Optional. Only spaces Outrider is a member of are listed. If a space is missing, add Outrider as a member in that space's
            settings (Space settings, Members). New access can take 10 to 15 minutes to reach search; until then Outrider lists the
            space's recent pages instead.
          </HelperMessage>
        </Box>
      </Stack>

      <Stack space="space.100">
        <Heading size="small">Fields</Heading>
        <Box>
          <FieldLabel id="affectedServicesField">Affected services field</FieldLabel>
          <Select inputId="affectedServicesField" options={servicesOptions} value={pick(servicesOptions, form.affectedServicesField)}
            onChange={(v) => setForm({ ...form, affectedServicesField: v?.value ?? '' })} />
          <HelperMessage>{detectedNote('affectedServicesField', form.affectedServicesField) ?? 'Used to break ties between equally relevant results. Optional.'}</HelperMessage>
        </Box>
        <Box>
          <FieldLabel id="requestTypeField">Request type field</FieldLabel>
          <Select inputId="requestTypeField" options={requestOptions} value={pick(requestOptions, form.requestTypeField)}
            onChange={(v) => setForm({ ...form, requestTypeField: v?.value ?? '' })} />
          <HelperMessage>{detectedNote('requestTypeField', form.requestTypeField) ?? 'The Jira Service Management request type. Optional.'}</HelperMessage>
        </Box>
      </Stack>

      <Stack space="space.100">
        <Heading size="small">Emerging incidents (request clustering)</Heading>
        <Text>
          Outrider can flag when several open requests report the same service, and optionally the same component,
          close together in time. A signal recommends investigation; Outrider never creates or declares an incident.
        </Text>
        <Box>
          <FieldLabel id="clusterEntityField">Entity field for clustering</FieldLabel>
          <Select inputId="clusterEntityField" options={entityOptions} value={pick(entityOptions, form.clusterEntityField)}
            onChange={(v) => setForm({ ...form, clusterEntityField: v?.value ?? '' })} />
          <HelperMessage>Optional. Components is the supported entity field. The service comes from the Affected services field above.</HelperMessage>
        </Box>
        <Box>
          <FieldLabel id="clusterWindowMinutes">Clustering window (minutes)</FieldLabel>
          <Textfield id="clusterWindowMinutes" type="number" placeholder="90" value={form.clusterWindowMinutes}
            onChange={(e) => setForm({ ...form, clusterWindowMinutes: e.target.value })} />
          <HelperMessage>Leave empty for the default, 90 minutes.</HelperMessage>
        </Box>
        <Box>
          <FieldLabel id="clusterThreshold">Requests needed for a signal</FieldLabel>
          <Textfield id="clusterThreshold" type="number" placeholder="5" value={form.clusterThreshold}
            onChange={(e) => setForm({ ...form, clusterThreshold: e.target.value })} />
          <HelperMessage>Leave empty for the default, 5 requests.</HelperMessage>
        </Box>
      </Stack>

      {result ? (
        <SectionMessage appearance={result.ok ? 'success' : 'error'}>
          {result.ok ? (
            <Text>Saved. Context is built when a ticket in these projects is created or updated: edit a ticket to build its context.</Text>
          ) : (
            <Text>{result.message} Your previous settings are still in effect.</Text>
          )}
        </SectionMessage>
      ) : null}
      <Box>
        <LoadingButton appearance="primary" isLoading={saving} onClick={save}>Save</LoadingButton>
      </Box>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
