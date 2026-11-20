// Outrider issue context panel (UI Kit).
// Renders the latest stored context bundle for this ticket. Read-only: no interaction here
// changes the bundle or starts a build (spec §17.7).
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, Button, Heading, Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Strong, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

// When no bundle exists yet, check once more after this delay (spec §17.6: one poll, no spinner loop).
const POLL_ONCE_AFTER_MS = 5000;

const STATUS_APPEARANCE = { active: 'removed', monitoring: 'moved', resolved: 'success' };
const MATCH_REASON_LABEL = { 'same-symptom': 'Similar symptoms', 'same-requester': 'Same requester', both: 'Same requester, similar symptoms' };

function formatDate(iso) {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown date' : d.toLocaleString();
}

const Freshness = ({ label, iso }) => <Text size="small" color="color.text.subtlest">{label} {formatDate(iso)}</Text>;

// Relevance indicator (spec §17.2): a simple visual weight, never the numeric score.
// relevance is the 0..1 match strength stored on each item.
const STRONG_MATCH = 0.5;
const GOOD_MATCH = 0.3;
function matchLabel(relevance) {
  if (typeof relevance !== 'number') return null;
  if (relevance >= STRONG_MATCH) return 'Strong match';
  if (relevance >= GOOD_MATCH) return 'Good match';
  return 'Partial match';
}

// One line under each item: relevance and freshness, e.g. "Strong match · Started 20/11/2026, 6:23 pm".
const ItemMeta = ({ relevance, label, iso }) => {
  const match = matchLabel(relevance);
  return <Text size="small" color="color.text.subtlest">{match ? `${match} · ` : ''}{label} {formatDate(iso)}</Text>;
};

const IncidentItem = ({ incident }) => (
  <Box paddingBlock="space.100">
    <Stack space="space.050">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={STATUS_APPEARANCE[incident.status] ?? 'default'}>{incident.status}</Lozenge>
        <Link href={incident.source.url} openNewTab>{incident.source.id}: {incident.source.title}</Link>
      </Inline>
      {incident.summary ? <Text>{incident.summary}</Text> : null}
      <ItemMeta relevance={incident.relevance} label="Started" iso={incident.startedAt ?? incident.source.updatedAt} />
    </Stack>
  </Box>
);

const ResolutionItem = ({ resolution }) => (
  <Box paddingBlock="space.100">
    <Stack space="space.050">
      <Inline space="space.100" alignBlock="center">
        <Lozenge>{MATCH_REASON_LABEL[resolution.matchReason] ?? resolution.matchReason}</Lozenge>
        <Link href={resolution.source.url} openNewTab>{resolution.source.id}: {resolution.source.title}</Link>
      </Inline>
      <Text>{resolution.resolutionText}</Text>
      <ItemMeta relevance={resolution.relevance} label="Resolved" iso={resolution.resolvedAt} />
    </Stack>
  </Box>
);

// Empty sections stay visible so the viewer can see the section was evaluated (spec §17.2).
const Section = ({ title, items, render }) => (
  <Stack space="space.050">
    <Heading size="small">{title}</Heading>
    {items.length === 0 ? <Text color="color.text.subtlest">No items</Text> : items.map(render)}
  </Stack>
);

const Bundle = ({ bundle }) => (
  <Stack space="space.200">
    {bundle.partial ? (
      <SectionMessage appearance="warning"><Text>Some sources are unavailable.</Text></SectionMessage>
    ) : null}
    <Section title="Active and recent incidents" items={bundle.incidents} render={(i) => <IncidentItem key={i.source.id} incident={i} />} />
    <Section title="Past resolutions" items={bundle.resolutions} render={(r) => <ResolutionItem key={r.source.id} resolution={r} />} />
  </Stack>
);

// Top row, styled like Jira's Automation panel: freshness on the left, Refresh on the right.
// Refresh re-reads the latest stored context. It never starts a build: the panel offers no
// rebuild trigger (spec §17.7). New context appears only after a ticket event is processed.
const Header = ({ builtAt, onRefresh, refreshing }) => (
  <Inline spread="space-between" alignBlock="center">
    {builtAt ? <Freshness label="Context built" iso={builtAt} /> : <Text size="small" color="color.text.subtlest">No context yet</Text>}
    <Button appearance="subtle" spacing="compact" iconBefore="refresh" onClick={onRefresh} isDisabled={refreshing}>
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </Button>
  </Inline>
);

const STATE_MESSAGE = {
  'no-bundle': 'Context is being prepared. Check back shortly.',
  queued: 'Context assembly is queued.',
  building: 'Context is being assembled.',
  superseded: 'A newer version is being prepared.',
  failed: 'Context could not be assembled.',
};

const App = () => {
  const [result, setResult] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const load = () => invoke('getContext').then((r) => { if (!cancelled) setResult(r); return r; });
    load().then((r) => {
      if (r && r.state !== 'complete' && r.state !== 'failed') {
        timer = setTimeout(load, POLL_ONCE_AFTER_MS);
      }
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  const refresh = () => {
    setRefreshing(true);
    invoke('getContext').then(setResult).finally(() => setRefreshing(false));
  };

  if (!result) return <Spinner label="Loading Outrider context" />;

  const message = STATE_MESSAGE[result.state];
  return (
    <Stack space="space.200">
      <Header builtAt={result.bundle?.builtAt} onRefresh={refresh} refreshing={refreshing} />
      {message && result.state !== 'complete' ? (
        <SectionMessage appearance={result.state === 'failed' ? 'error' : 'information'}>
          <Text>{message}</Text>
          {result.bundle ? <Text><Strong>Showing the last available context, which may be out of date.</Strong></Text> : null}
        </SectionMessage>
      ) : null}
      {result.bundle ? <Bundle bundle={result.bundle} /> : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
