// Outrider settings page (jira:adminPage, UI Kit). Spec Phase 5.5.
// Admins choose which projects get context and which are searched; the two custom fields are detected
// and can be overridden. Saving is validated by the resolver; a rejected save changes nothing.
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, Heading, HelperMessage, Label, LoadingButton, SectionMessage, Select, Spinner, Stack, Text } from '@forge/react';
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
          <Label labelFor="bundleProjects">Projects whose tickets get context</Label>
          <Select inputId="bundleProjects" isMulti options={projectOptions} value={chosen(form.bundleProjects)}
            onChange={(v) => setForm({ ...form, bundleProjects: (v ?? []).map((o) => o.value) })} />
          <HelperMessage>Usually your service desk projects. The Outrider panel shows context on these tickets.</HelperMessage>
        </Box>
        <Box>
          <Label labelFor="sourceProjects">Projects to search for incidents and past resolutions</Label>
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
          <Label labelFor="confluenceSpaces">Confluence spaces to search for runbooks and articles</Label>
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
          <Label labelFor="affectedServicesField">Affected services field</Label>
          <Select inputId="affectedServicesField" options={servicesOptions} value={pick(servicesOptions, form.affectedServicesField)}
            onChange={(v) => setForm({ ...form, affectedServicesField: v?.value ?? '' })} />
          <HelperMessage>{detectedNote('affectedServicesField', form.affectedServicesField) ?? 'Used to break ties between equally relevant results. Optional.'}</HelperMessage>
        </Box>
        <Box>
          <Label labelFor="requestTypeField">Request type field</Label>
          <Select inputId="requestTypeField" options={requestOptions} value={pick(requestOptions, form.requestTypeField)}
            onChange={(v) => setForm({ ...form, requestTypeField: v?.value ?? '' })} />
          <HelperMessage>{detectedNote('requestTypeField', form.requestTypeField) ?? 'The Jira Service Management request type. Optional.'}</HelperMessage>
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
