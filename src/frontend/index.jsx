// Outrider issue context panel (UI Kit).
// Renders the latest stored context bundle for this ticket. Read-only: no interaction here
// changes the bundle or starts a build (spec §17.7).
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Box, Button, Em, Heading, Inline, Link, Lozenge, SectionMessage, Spinner, Stack, Strike, Strong, Text, useProductContext } from '@forge/react';
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
// relevance is the share of the ticket's distinctive words the item contains (0..1), so the label says
// "word match". The order of items comes from the ranking, which also uses embeddings when they are available;
// a label naming the ranking score would need thresholds that hold on every site, and embedding scores do not
// (found in review: on the demo site right and unrelated pages were 0.03 apart).
const STRONG_MATCH = 0.5;
const GOOD_MATCH = 0.3;
function matchLabel(relevance) {
  if (typeof relevance !== 'number') return null;
  if (relevance >= STRONG_MATCH) return 'Strong word match';
  if (relevance >= GOOD_MATCH) return 'Good word match';
  return 'Partial word match';
}

// One line under each item: relevance and freshness, e.g. "Strong word match · Started 20/11/2026, 6:23 pm".
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

// A team linked (in Atlassian Teams) to the project of a related incident, from Teamwork Graph at read time.
// The evidence line says which project and incident connect it, so it never reads as an owner the app guessed.
const TeamItem = ({ team }) => (
  <Box paddingBlock="space.100">
    <Stack space="space.050">
      {team.url ? <Link href={team.url} openNewTab>{team.name}</Link> : <Text><Strong>{team.name}</Strong></Text>}
      <Text size="small" color="color.text.subtlest">{team.evidence}</Text>
    </Stack>
  </Box>
);

// Must match TWG_UNAVAILABLE and TWG_PARTIAL in src/domain/teams.ts.
const TWG_UNAVAILABLE = 'twg:unavailable';
const TWG_PARTIAL = 'twg:partial';
const NO_TEAMS = "No teams linked to this project's space. Link a team to the project in Atlassian Teams to see it here.";
const TEAMS_UNAVAILABLE = "Teams couldn't be checked right now.";
// Some projects answered and some did not: never say "no team linked" for the ones that did not.
const SOME_TEAMS_UNAVAILABLE = "Some teams couldn't be checked right now.";

/** The Teams involved message when there are no teams to list, and the note under the list when there are. */
const teamsMessages = (bundle) => {
  const failures = bundle.failures ?? [];
  if (failures.includes(TWG_UNAVAILABLE)) return { empty: TEAMS_UNAVAILABLE, note: null };
  if (failures.includes(TWG_PARTIAL)) return { empty: SOME_TEAMS_UNAVAILABLE, note: SOME_TEAMS_UNAVAILABLE };
  return { empty: (bundle.incidents ?? []).length === 0 ? NO_INCIDENTS_FOR_TEAMS : NO_TEAMS, note: null };
};
// Teams are looked up only from related incidents; with none, there is nothing to look up.
const NO_INCIDENTS_FOR_TEAMS = 'No related incidents to look up teams for.';

const ARTICLE_KIND_LABEL = { runbook: 'Runbook', policy: 'Policy', guide: 'Guide' };

const ArticleItem = ({ article }) => (
  <Box paddingBlock="space.100">
    <Stack space="space.050">
      <Box>
        <Lozenge appearance="new">{ARTICLE_KIND_LABEL[article.kind] ?? article.kind}</Lozenge>
      </Box>
      <Link href={article.source.url} openNewTab>{article.source.title}</Link>
      {article.excerpt ? <Text>{article.excerpt}</Text> : null}
      <ItemMeta relevance={article.relevance} label="Updated" iso={article.source.updatedAt} />
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
// Accurate for both cases the verifier rejects: a claim the source does not support, and a true claim the
// model reworded too far from the source's wording (spec §13.2 step 6a).
const REJECTION_REASON_LABEL = { 'no-matching-span': "couldn't match this to the source's wording" };
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
      <Heading size="small">Summary</Heading>
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
// Each section with items has its own Show less / Show more toggle. Sections start expanded: the panel exists to
// surface context, so the viewer collapses what they don't need. There is no "collapse all".
const Section = ({ title, items, render, empty = 'No items', note = null }) => {
  const [open, setOpen] = useState(true);
  return (
    <Stack space="space.050">
      <Inline spread="space-between" alignBlock="center">
        <Heading size="small">{title}</Heading>
        {items.length > 0 ? (
          <Button appearance="subtle" spacing="compact" onClick={() => setOpen(!open)}>
            {open ? 'Show less' : 'Show more'}
          </Button>
        ) : null}
      </Inline>
      {items.length === 0 ? <Text color="color.text.subtlest">{empty}</Text> : open ? items.map(render) : null}
      {items.length > 0 && note ? <Text size="small" color="color.text.subtlest">{note}</Text> : null}
    </Stack>
  );
};

// ---- Emerging incident (spec §17.4, step 13) ----
// Advisory only: the card recommends investigation and never creates, declares or assigns anything (§14.10).
// The server sends only signals the viewer can see enough of; this component never filters.
const SIGNAL_STATE_LABEL = { confirmed: 'Confirmed', uncertain: 'Uncertain' };
const SIGNAL_REASON = {
  'missing-entity-identity': 'These requests share a service, but at least one does not name a component, so the grouping is less certain.',
  'missing-service-identity': 'These requests share a component, but at least one does not name an affected service, so the grouping is less certain.',
};
const ENTITY_LABEL = { asset: 'asset', component: 'component', endpoint: 'endpoint' };

function signalHeadline(s) {
  const service = s.serviceName ? `the same affected service, ${s.serviceName}` : s.serviceId ? 'the same affected service' : null;
  const entity = s.entityId ? `the same ${ENTITY_LABEL[s.entityKind] ?? 'entity'}${s.entityName ? `, ${s.entityName}` : ''}` : null;
  return `${s.requestCount} open requests report ${[service, entity].filter(Boolean).join(' and ')}.`;
}

const SignalCard = ({ signal, onDismissed }) => {
  const siteUrl = useProductContext()?.siteUrl;
  const [dismissing, setDismissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const dismiss = () => {
    setDismissing(true);
    setFailed(false);
    invoke('dismissSignal', { signalId: signal.signalId })
      .then((r) => (r?.ok ? onDismissed() : setFailed(true)))
      .catch(() => setFailed(true))
      .finally(() => setDismissing(false));
  };
  return (
    <SectionMessage appearance="warning" title="Possible emerging incident">
      <Stack space="space.100">
        <Box>
          <Lozenge appearance={signal.state === 'confirmed' ? 'removed' : 'moved'}>{SIGNAL_STATE_LABEL[signal.state] ?? signal.state}</Lozenge>
        </Box>
        <Text>{signalHeadline(signal)}</Text>
        {signal.reason ? <Text size="small">{SIGNAL_REASON[signal.reason] ?? signal.reason}</Text> : null}
        <Text size="small" color="color.text.subtlest">Created from {formatDate(signal.windowStart)}; this signal ends {formatDate(signal.windowEnd)}.</Text>
        <Inline space="space.100" shouldWrap>
          {signal.requestKeys.map((k) => (siteUrl ? <Link key={k} href={`${siteUrl}/browse/${k}`} openNewTab>{k}</Link> : <Text key={k}>{k}</Text>))}
        </Inline>
        <Text>Investigation recommended. Outrider does not create or declare an incident.</Text>
        <Inline space="space.100" alignBlock="center">
          <Button appearance="subtle" spacing="compact" onClick={dismiss} isDisabled={dismissing}>{dismissing ? 'Dismissing…' : 'Dismiss'}</Button>
          {failed ? <Text size="small">Could not dismiss this signal. Try again.</Text> : null}
        </Inline>
      </Stack>
    </SectionMessage>
  );
};

const Bundle = ({ bundle, onRefresh }) => (
  <Stack space="space.200">
    {(bundle.emergingSignals ?? []).map((s) => <SignalCard key={s.signalId} signal={s} onDismissed={onRefresh} />)}
    {bundle.partial ? (
      <SectionMessage appearance="warning"><Text>Some sources are unavailable.</Text></SectionMessage>
    ) : null}
    {/* No summary means none survived verification for this viewer: nothing is rendered (spec §17.3). */}
    {bundle.summary && bundle.summary.claims && bundle.summary.claims.length > 0 ? <Summary summary={bundle.summary} /> : null}
    <Section title="Active and recent incidents" items={bundle.incidents} render={(i) => <IncidentItem key={i.source.id} incident={i} />} />
    <Section title="Teams involved" items={bundle.teams ?? []} render={(t) => <TeamItem key={t.teamId} team={t} />}
      empty={teamsMessages(bundle).empty} note={teamsMessages(bundle).note} />
    <Section title="Past resolutions" items={bundle.resolutions} render={(r) => <ResolutionItem key={r.source.id} resolution={r} />} />
    <Section title="Knowledge articles" items={bundle.articles ?? []} render={(a) => <ArticleItem key={a.source.id} article={a} />} />
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
  // Must match NOT_SET_UP_MESSAGE in src/domain/settings.ts (spec Phase 5.5).
  'not-set-up': "Outrider isn't set up for this project yet. Ask a Jira admin to configure it.",
  queued: 'Context assembly is queued.',
  building: 'Context is being assembled.',
  superseded: 'A newer version is being prepared.',
  failed: 'Context could not be assembled.',
  // Client-side only: the request to Outrider itself failed (found in review: the spinner used to stay forever).
  'load-failed': "Outrider couldn't load right now.",
};

// Outrider's own app ID (manifest.yml app.id), not a site setting. With the environment ID from the product
// context it gives the settings page address (jira:adminPage with useAsConfig, spec Phase 5.5).
const APP_ID = '91f15c4b-555e-4db0-99e1-7567c801fc07';
const settingsUrl = (context) =>
  context?.siteUrl && context?.environmentId ? `${context.siteUrl}/jira/settings/apps/configure/${APP_ID}/${context.environmentId}` : null;

// Shown when the site or this project is not set up. The link helps whoever sees the message; only Jira admins
// can open the page, so it reveals nothing and grants nothing.
const NotSetUp = ({ message }) => {
  const url = settingsUrl(useProductContext());
  return (
    <SectionMessage appearance="information">
      <Text>{message}</Text>
      {url ? <Text><Link href={url} openNewTab>Open Outrider settings</Link> (Jira admins only)</Text> : null}
    </SectionMessage>
  );
};

const App = () => {
  const [result, setResult] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const load = () => invoke('getContext').then((r) => { if (!cancelled) setResult(r); return r; });
    load().catch((err) => {
      console.error('Outrider: loading context failed', err);
      if (!cancelled) setResult({ state: 'load-failed' });
      return null;
    }).then((r) => {
      if (r && r.state !== 'complete' && r.state !== 'failed' && r.state !== 'unavailable' && r.state !== 'not-set-up') {
        timer = setTimeout(() => load().catch((err) => console.error('Outrider: reloading context failed', err)), POLL_ONCE_AFTER_MS);
      }
    });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  const refresh = () => {
    setRefreshing(true);
    invoke('getContext')
      .then(setResult)
      .catch((err) => console.error('Outrider: refreshing context failed', err)) // keep what is shown
      .finally(() => setRefreshing(false));
  };

  if (!result) return <Spinner label="Loading Outrider context" />;

  const message = STATE_MESSAGE[result.state];
  if (result.state === 'not-set-up') return <NotSetUp message={message} />;
  if (result.state === 'load-failed') {
    return (
      <SectionMessage appearance="warning">
        <Text>{message}</Text>
        <Button appearance="subtle" spacing="compact" iconBefore="refresh" onClick={refresh} isDisabled={refreshing}>
          {refreshing ? 'Trying again…' : 'Try again'}
        </Button>
      </SectionMessage>
    );
  }
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
      {result.bundle ? <Bundle bundle={result.bundle} onRefresh={refresh} /> : null}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
