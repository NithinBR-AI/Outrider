// Outrider issue context panel (UI Kit).
// Renders the latest stored context bundle for this ticket. Read-only: no interaction here
// changes the bundle or starts a build (spec §17.7).
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, Button, Em, Heading, Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Strike, Strong, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

// When no bundle exists yet, check once more after this delay (spec §17.6: one poll, no spinner loop).
const POLL_ONCE_AFTER_MS = 5000;

const STATUS_APPEARANCE = { active: 'removed', monitoring: 'moved', resolved: 'success' };
const STATUS_LABEL = { active: 'Active', monitoring: 'Monitoring', resolved: 'Resolved' };
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
      {/* Lozenge on its own line: inside an Inline next to a long link it was truncated ("act…"). */}
      <Box>
        <Lozenge appearance={STATUS_APPEARANCE[incident.status] ?? 'default'}>{STATUS_LABEL[incident.status] ?? incident.status}</Lozenge>
      </Box>
      <Link href={incident.source.url} openNewTab>{incident.source.id}: {incident.source.title}</Link>
      {incident.summary ? <Text>{incident.summary}</Text> : null}
      <ItemMeta relevance={incident.relevance} label="Started" iso={incident.startedAt ?? incident.source.updatedAt} />
    </Stack>
  </Box>
);

const ResolutionItem = ({ resolution }) => (
  <Box paddingBlock="space.100">
    <Stack space="space.050">
      <Box>
        <Lozenge>{MATCH_REASON_LABEL[resolution.matchReason] ?? resolution.matchReason}</Lozenge>
      </Box>
      <Link href={resolution.source.url} openNewTab>{resolution.source.id}: {resolution.source.title}</Link>
      <Text>{resolution.resolutionText}</Text>
      <ItemMeta relevance={resolution.relevance} label="Resolved" iso={resolution.resolvedAt} />
    </Stack>
  </Box>
);

// ---- Summary (spec §17.3) ----
// The resolver sends only claims already verified for this viewer: each kept claim shares a verbatim
// span with its cited source. Wording follows spec §1.4 and §13.4: "claims with matching source spans",
// never "verified". The rejected list only ever contains no-matching-span rejections.
const REJECTION_REASON_LABEL = { 'no-matching-span': "the cited source doesn't contain this" };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const ClaimItem = ({ claim }) => {
  const [open, setOpen] = useState(false);
  return (
    <Box paddingBlock="space.050">
      <Stack space="space.050">
        <Text>{claim.text}</Text>
        <Inline>
          <Button appearance="subtle" spacing="compact" onClick={() => setOpen(!open)}>
            {open ? 'Hide sources' : 'Show sources'}
          </Button>
        </Inline>
        {open ? (
          <Stack space="space.050">
            <Text size="small" color="color.text.subtlest">From the source:</Text>
            <Text><Em>“{claim.span}”</Em></Text>
            <Link href={claim.source.url} openNewTab>{claim.source.id}: {claim.source.title}</Link>
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
};

const RejectedList = ({ rejected }) => (
  <Stack space="space.100">
    {rejected.map((r, i) => (
      <Stack key={i} space="space.025">
        <Text><Strike>{r.text}</Strike></Text>
        <Text size="small" color="color.text.subtlest">Removed: {REJECTION_REASON_LABEL[r.reason] ?? r.reason}</Text>
      </Stack>
    ))}
  </Stack>
);

const Summary = ({ summary }) => {
  const [showRejected, setShowRejected] = useState(false);
  const rejected = summary.rejected ?? [];
  return (
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Heading size="small">Summary</Heading>
        {summary.origin === 'demo-fixture' ? <Lozenge appearance="new">Demo fixture</Lozenge> : null}
      </Inline>
      <Text size="small" color="color.text.subtlest">
        {plural(summary.claims.length, 'claim with a matching source span', 'claims with matching source spans')}
      </Text>
      {summary.claims.map((c, i) => <ClaimItem key={i} claim={c} />)}
      {rejected.length > 0 ? (
        <Inline space="space.050" alignBlock="center">
          <Text size="small" color="color.text.subtlest">{rejected.length} rejected ·</Text>
          <Button appearance="subtle" spacing="compact" onClick={() => setShowRejected(!showRejected)}>
            {showRejected ? 'hide' : 'see why'}
          </Button>
        </Inline>
      ) : null}
      {showRejected ? <RejectedList rejected={rejected} /> : null}
    </Stack>
  );
};

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
    {/* No summary means none survived verification for this viewer: nothing is rendered (spec §17.3). */}
    {bundle.summary && bundle.summary.claims && bundle.summary.claims.length > 0 ? <Summary summary={bundle.summary} /> : null}
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
  // Generic on purpose: never says whether context exists for this ticket (spec §17.1).
  unavailable: 'Outrider context is not available.',
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
      if (r && r.state !== 'complete' && r.state !== 'failed' && r.state !== 'unavailable') {
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
  if (result.state === 'unavailable') {
    // Nothing else is rendered: no freshness, no build state, no hint that context exists.
    return <SectionMessage appearance="information"><Text>{message}</Text></SectionMessage>;
  }
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
