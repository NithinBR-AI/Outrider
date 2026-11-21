// Source-span verifier tests (spec §13.5, §19.2). Pure: no Forge, no I/O.
// "Demo site" fixtures use real text recorded from one-atlas-edlg (tests/fixtures/jira-demo-site.json).
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { citedSources, findSpan, LiveSource, MIN_COVERAGE, MIN_SPAN_CHARS, normalizeText, normalizeWord, qualifies, sourceKey, spanCoverage, toWords, verifyClaims } from '../verify';
import { adfToText } from '../extract';
import { GeneratedClaim, SourceRef } from '../types';

// Typed loosely on purpose: raw recorded Jira JSON.
const fixture: any = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'jira-demo-site.json'), 'utf8'));
const commentsOf = (key: string): string[] => fixture.comments[key].comments.map((c: { body: unknown }) => adfToText(c.body));

const ref = (id: string, kind: SourceRef['kind'] = 'jira-issue'): SourceRef => ({ kind, id, url: `https://x/browse/${id}`, title: id, updatedAt: 'u' });
const claim = (text: string, cited: SourceRef | null, claimId = 'c'): GeneratedClaim => ({ claimId, text, citedSourceRef: cited });
const live = (...sources: [string, string][]): Map<string, LiveSource> =>
  new Map(sources.map(([id, text]) => [sourceKey(ref(id)), { ref: { ...ref(id), title: `${id} (live title)` }, text }]));

// ---- The spec's required cases (§13.5, §19.2) ----

describe('required verifier cases', () => {
  const SOURCE = 'Root cause: SSL certificate on auth-lb-01 expired at 02:00 UTC. Resolution: renewed certificate via Let\'s Encrypt and reloaded nginx.';

  it('exact sentence match passes', () => {
    expect(findSpan('Resolution: renewed certificate via Let\'s Encrypt and reloaded nginx.', SOURCE)?.span).toBe("Resolution: renewed certificate via Let's Encrypt and reloaded nginx.");
  });

  it('whitespace-normalized match passes', () => {
    expect(findSpan('the   SSL\ncertificate on\tauth-lb-01   expired', SOURCE)).not.toBeNull();
  });

  it('Markdown-wrapped source passes after normalization', () => {
    const markdown = '## Resolution\n**Renewed the certificate** via `certbot renew` and _reloaded nginx_.';
    expect(findSpan('Renewed the certificate via certbot renew and reloaded nginx', markdown)).not.toBeNull();
  });

  it('controlled paraphrase with no qualifying span fails', () => {
    expect(findSpan('The TLS cert on the load balancer lapsed overnight and was replaced', SOURCE)).toBeNull();
  });

  it('empty source fails', () => {
    expect(findSpan('renewed certificate via Let\'s Encrypt', '')).toBeNull();
    expect(findSpan('renewed certificate via Let\'s Encrypt', '   \n  ')).toBeNull();
  });

  it('match shorter than MIN_SPAN_CHARS fails', () => {
    expect(MIN_SPAN_CHARS).toBe(12);
    // "ssl expired" is 11 characters normalized, two distinctive words, still too short.
    expect(findSpan('The ssl expired yesterday', 'Note: ssl expired.')).toBeNull();
  });

  it('claim whose cited source is null is omitted entirely: not in claims, not in rejected', () => {
    const r = verifyClaims([claim('renewed certificate via Let\'s Encrypt', null)], live(['ITO-9642', SOURCE]));
    expect(r).toEqual({ claims: [], rejected: [] });
  });

  it('claim whose cited source is unauthorized for the viewer is omitted entirely', () => {
    // ITO-9642 is not in the viewer's live sources: unauthorized and unresolvable look the same.
    const r = verifyClaims([claim('renewed certificate via Let\'s Encrypt', ref('ITO-9642'))], live());
    expect(r).toEqual({ claims: [], rejected: [] });
  });

  it('common boilerplate ("the user cannot") is not sufficient evidence on its own', () => {
    expect('the user cannot'.length).toBeGreaterThanOrEqual(MIN_SPAN_CHARS); // long enough on length alone
    expect(qualifies('the user cannot')).toBe(false);
    expect(findSpan('The user cannot reach the billing portal', 'Note: the user cannot log in to the VPN')).toBeNull();
  });

  it('a fixture that passes a naive substring check fails once length and distinctiveness apply', () => {
    const source = 'Hello Emma, thank you for contacting our IT support service desk.';
    const fabricated = 'Thank you for contacting our team, the database was migrated';
    // Naive: a long shared substring exists ("thank you for contacting our ").
    expect(source.toLowerCase()).toContain('thank you for contacting our');
    expect(findSpan(fabricated, source)).toBeNull();
  });

  it('authorization first: a paraphrase of an inaccessible source produces no output at all', () => {
    const r = verifyClaims([claim('The certificate on auth-lb-01 expired and was renewed', ref('ITO-9642'))], live(['ITS-6258', 'We reset the VPN today.']));
    expect(r.claims).toEqual([]);
    expect(r.rejected).toEqual([]);
    expect(JSON.stringify(r)).not.toContain('auth-lb-01');
  });

  it('matches against the live text, not a cached copy', () => {
    const cachedExcerpt = 'Root cause: SSL certificate on auth-lb-01 expired at 02:00 UTC.';
    const liveText = 'Root cause was revised: a firewall rule blocked the health check.';
    const claims = [claim('SSL certificate on auth-lb-01 expired at 02:00 UTC', ref('ITO-9642'), 'stale'), claim('a firewall rule blocked the health check', ref('ITO-9642'), 'current')];
    const r = verifyClaims(claims, live(['ITO-9642', liveText]));
    expect(cachedExcerpt).toContain('SSL certificate on auth-lb-01'); // would have matched the cached copy
    expect(r.claims.map((c) => c.text)).toEqual(['a firewall rule blocked the health check']);
    expect(r.rejected).toEqual([{ text: 'SSL certificate on auth-lb-01 expired at 02:00 UTC', reason: 'no-matching-span' }]);
  });
});

// ---- Coverage rule (§13.2 step 6a, §13.5) ----

describe('coverage rule', () => {
  const SSL = 'Root cause: SSL certificate on auth-lb-01 expired at 02:00 UTC. Resolution: renewed certificate via Let\'s Encrypt and reloaded nginx.';

  it('MIN_COVERAGE is one half', () => {
    expect(MIN_COVERAGE).toBe(0.5);
  });

  it('a long claim whose only qualifying span covers too little of it is rejected with no-matching-span', () => {
    const text = 'Agents should escalate to the platform group, page the database owner, freeze deployments and renew certificate via Let\'s Encrypt';
    expect(findSpan(text, SSL)).not.toBeNull(); // the old rule alone would have shown it
    expect(spanCoverage(text, SSL)).toBeLessThan(MIN_COVERAGE);
    expect(verifyClaims([claim(text, ref('ITO-9642'))], live(['ITO-9642', SSL]))).toEqual({ claims: [], rejected: [{ text, reason: 'no-matching-span' }] });
  });

  it('two separate qualifying spans that together reach MIN_COVERAGE pass, though neither does alone', () => {
    const text = 'SSL certificate on auth-lb-01 expired; marketing approved quarterly budgets; renewed certificate via Let\'s Encrypt';
    const firstHalfOnly = 'Root cause: SSL certificate on auth-lb-01 expired at 02:00 UTC.';
    const secondHalfOnly = 'Resolution: renewed certificate via Let\'s Encrypt and reloaded nginx.';
    expect(spanCoverage(text, firstHalfOnly)).toBeLessThan(MIN_COVERAGE);
    expect(spanCoverage(text, secondHalfOnly)).toBeLessThan(MIN_COVERAGE);
    expect(spanCoverage(text, SSL)).toBeGreaterThanOrEqual(MIN_COVERAGE);
    expect(verifyClaims([claim(text, ref('ITO-9642'))], live(['ITO-9642', SSL])).claims).toHaveLength(1);
  });

  it('coverage exactly at MIN_COVERAGE passes; just below fails', () => {
    const source = 'Update: nginx certificate expired overnight.';
    // Distinctive words: nginx, certificate, expired | database, replica, lagging. Three of six covered.
    const atThreshold = 'nginx certificate expired; database replica lagging';
    // One more uncovered distinctive word: three of seven.
    const belowThreshold = 'nginx certificate expired; database replica lagging behind';
    expect(spanCoverage(atThreshold, source)).toBe(0.5);
    expect(spanCoverage(belowThreshold, source)).toBeLessThan(0.5);
    expect(verifyClaims([claim(atThreshold, ref('X-1'))], live(['X-1', source])).claims).toHaveLength(1);
    expect(verifyClaims([claim(belowThreshold, ref('X-1'))], live(['X-1', source])).rejected).toHaveLength(1);
  });

  it('a claim quoting its source in full has coverage 1; a claim with no distinctive words has coverage 0', () => {
    expect(spanCoverage('Renewed certificate via Let\'s Encrypt and reloaded nginx.', SSL)).toBe(1);
    expect(spanCoverage('it is what it was', SSL)).toBe(0);
    expect(spanCoverage('', SSL)).toBe(0);
  });

  it('filler words do not count: only distinctive words are measured', () => {
    // Same covered phrase, padded with stopwords only: coverage is unchanged.
    expect(spanCoverage('and so it is that the renewed certificate via Let\'s Encrypt was', SSL)).toBe(spanCoverage('renewed certificate via Let\'s Encrypt', SSL));
  });

  it('regression (step 8c prompt test): advice that shares one short phrase with the real SSL fix is rejected', () => {
    const sslFix = [fixture.resolutionSearch.issues, fixture.incidentSearch.issues, fixture.requesterSearch.issues].flat().find((i: { key: string }) => i.key === 'ITO-9642');
    const sourceText = [sslFix.fields.summary, adfToText(sslFix.fields.description), ...commentsOf('ITO-9642')].join('\n');
    const text = 'The agent could check whether the incident has been updated with new findings, confirm if certificate expiry alerts are active, and ensure the requester is directed to the StatusPage for updates.';
    expect(findSpan(text, sourceText)?.normalizedSpan).toBe('certificate expiry');
    expect(verifyClaims([claim(text, ref('ITO-9642'))], live(['ITO-9642', sourceText])).rejected).toEqual([{ text, reason: 'no-matching-span' }]);
  });
});

// ---- Demo site text ----

describe('real demo-site sources', () => {
  const sslFix = commentsOf('ITO-9642').join('\n');
  const vpnThread = commentsOf('ITS-6258').join('\n');

  it('a claim quoting the SSL fix comment is grounded, with the original span', () => {
    const r = verifyClaims([claim('The fix was to renew the certificate via Let\'s Encrypt and reload nginx.', ref('ITO-9642'))], live(['ITO-9642', sslFix]));
    expect(r.rejected).toEqual([]);
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].span).toContain('certificate via Let');
    expect(sslFix).toContain(r.claims[0].span); // the span is verbatim from the source
  });

  it('a claim with a typographic apostrophe matches the source\'s straight one, and vice versa', () => {
    expect(findSpan('renewed certificate via Let\u2019s Encrypt', sslFix)).not.toBeNull();
    expect(findSpan('That\'s great to hear! I\'ll resolve the ticket', 'That\u2019s great to hear! I\u2019ll resolve the ticket but if you notice')).not.toBeNull();
  });

  it('a fabricated claim citing the SSL fix is rejected with no-matching-span', () => {
    const r = verifyClaims([claim('The outage was caused by a misconfigured DNS record on the primary database.', ref('ITO-9642'))], live(['ITO-9642', sslFix]));
    expect(r.claims).toEqual([]);
    expect(r.rejected).toEqual([{ text: 'The outage was caused by a misconfigured DNS record on the primary database.', reason: 'no-matching-span' }]);
  });

  it('the fix in the VPN thread is grounded, even though it is not the newest comment', () => {
    expect(findSpan('Support reset the VPN today; the simplest solution is to shut down your phone and restart it.', vpnThread)).not.toBeNull();
  });

  it('a claim citing the wrong source is rejected even if another source would support it', () => {
    const r = verifyClaims([claim('renewed certificate via Let\'s Encrypt and reloaded nginx', ref('ITS-6258'))], live(['ITO-9642', sslFix], ['ITS-6258', vpnThread]));
    expect(r.claims).toEqual([]);
    expect(r.rejected).toHaveLength(1);
  });
});

// ---- Mechanics ----

describe('normalization', () => {
  it('folds typographic quotes and dashes, strips Markdown, case-folds and collapses whitespace', () => {
    expect(normalizeText('  **Don\u2019t**  restart \u2014 `nginx`\n\n## Now ')).toBe("don't restart nginx now");
  });

  it('drops words that are only punctuation or Markdown', () => {
    expect(normalizeText('- * > ## --- ``')).toBe('');
  });

  it('keeps punctuation inside a word', () => {
    expect(normalizeWord('auth-lb-01,')).toBe('auth-lb-01');
    expect(normalizeWord('"02:00')).toBe('02:00');
    expect(normalizeWord('_reloaded_')).toBe('reloaded');
  });

  it('keeps each word\'s position in the original text', () => {
    expect(toWords('  Hello  World.')).toEqual([{ norm: 'hello', start: 2, end: 7 }, { norm: 'world', start: 9, end: 15 }]);
    expect(toWords(undefined as unknown as string)).toEqual([]);
  });
});

describe('findSpan', () => {
  it('returns whole words only, never fragments', () => {
    const m = findSpan('restarting the auth service fixed it', 'We tried restarting the auth service, which fixed the login errors.');
    expect(m?.span).toBe('restarting the auth service,');
  });

  it('prefers the longest qualifying run', () => {
    const src = 'renewed certificate today. Later we renewed certificate via Let\'s Encrypt and reloaded nginx.';
    expect(findSpan('we renewed certificate via Let\'s Encrypt and reloaded nginx', src)?.normalizedSpan).toBe("we renewed certificate via let's encrypt and reloaded nginx");
  });

  it('does not let a long boilerplate run hide a shorter real one', () => {
    const src = 'Thank you for contacting our IT support service desk. Root cause: expired SSL certificate.';
    const m = findSpan('Thank you for contacting our IT team about the expired SSL certificate', src);
    expect(m?.normalizedSpan).toBe('expired ssl certificate');
  });

  it('breaks ties by the earliest run in the source', () => {
    const src = 'Step one: rotate signing keys. Step two: rotate signing keys again.';
    const m = findSpan('rotate signing keys', src);
    expect(m?.span).toBe('rotate signing keys.');
    expect(src.indexOf(m!.span)).toBe(src.indexOf('rotate signing keys'));
  });

  it('returns null for an empty claim', () => {
    expect(findSpan('', 'renewed certificate via Let\'s Encrypt')).toBeNull();
  });
});

describe('qualifies', () => {
  it('needs both the minimum length and at least two distinctive words', () => {
    expect(qualifies('renewed certificate')).toBe(true);
    expect(qualifies('certificate')).toBe(false); // one distinctive word
    expect(qualifies('the user cannot do it')).toBe(false); // long, no distinctive words
    expect(qualifies('vpn reset')).toBe(false); // two words, too short
  });
});

describe('verifyClaims', () => {
  it('uses the live source reference, so links point to the current location', () => {
    const r = verifyClaims([claim('renewed certificate via Let\'s Encrypt', ref('ITO-9642'))], live(['ITO-9642', 'We renewed certificate via Let\'s Encrypt.']));
    expect(r.claims[0].source.title).toBe('ITO-9642 (live title)');
    expect(r.claims[0].grounded).toBe(true);
  });

  it('keeps claim order and handles mixed outcomes', () => {
    const claims = [claim('renewed certificate via Let\'s Encrypt', ref('ITO-1'), 'a'), claim('made up statement about payments', ref('ITO-1'), 'b'), claim('no citation here', null, 'c'), claim('rebooted the vpn gateway', ref('ITO-2'), 'd')];
    const r = verifyClaims(claims, live(['ITO-1', 'We renewed certificate via Let\'s Encrypt.']));
    expect(r.claims.map((c) => c.text)).toEqual(['renewed certificate via Let\'s Encrypt']);
    expect(r.rejected.map((c) => c.text)).toEqual(['made up statement about payments']);
  });

  it('never reveals the rejection reason for omitted claims, and only ever reports no-matching-span', () => {
    const r = verifyClaims([claim('x y z', ref('ITO-1')), claim('a', null)], live(['ITO-1', 'nothing related']));
    expect(r.rejected.every((x) => x.reason === 'no-matching-span')).toBe(true);
  });

  it('treats a Confluence citation with no live source as omitted', () => {
    const r = verifyClaims([claim('renewed certificate via Let\'s Encrypt', ref('4194312', 'confluence-page'))], live(['ITO-1', 'renewed certificate via Let\'s Encrypt']));
    expect(r).toEqual({ claims: [], rejected: [] });
  });

  it('handles no claims', () => {
    expect(verifyClaims([], new Map())).toEqual({ claims: [], rejected: [] });
    expect(verifyClaims(undefined as unknown as GeneratedClaim[], new Map())).toEqual({ claims: [], rejected: [] });
  });
});

describe('citedSources', () => {
  it('lists each cited source once and skips uncited claims', () => {
    const claims = [claim('a', ref('ITO-1')), claim('b', ref('ITO-1')), claim('c', null), claim('d', ref('4194312', 'confluence-page'))];
    expect(citedSources(claims).map(sourceKey)).toEqual(['jira-issue:ITO-1', 'confluence-page:4194312']);
    expect(citedSources(undefined as unknown as GeneratedClaim[])).toEqual([]);
  });
});
