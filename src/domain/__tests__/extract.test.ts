// Domain tests for retrieval text helpers. No Forge imports, no I/O (spec §19.1).
// Fixtures marked "demo site" are real texts from one-atlas-edlg (see outrider-seed).
import { describe, expect, it } from 'vitest';
import {
  adfToText,
  excerpt,
  extractKeywords,
  keywordOverlap,
  mapIncidentStatus,
  MAX_TICKET_KEYWORDS,
  pickResolutionComment,
  ResolutionCommentCandidate,
  SUMMARY_KEYWORD_WEIGHT,
  tokenize,
} from '../extract';

// Mirrors MIN_SYMPTOM_OVERLAP in adapters/jira.ts. The regression tests below check real
// tickets land on the right side of the cutoff the adapter uses.
const MIN_SYMPTOM_OVERLAP = 0.2;

describe('adfToText', () => {
  it('returns plain strings unchanged', () => {
    expect(adfToText('plain text')).toBe('plain text');
  });

  it('returns empty text for null, undefined and non-objects', () => {
    expect(adfToText(null)).toBe('');
    expect(adfToText(undefined)).toBe('');
    expect(adfToText(42)).toBe('');
  });

  it('returns empty text for nodes without text or content (for example a hard break)', () => {
    expect(adfToText({ type: 'hardBreak' })).toBe('');
  });

  it('flattens nested ADF and keeps paragraphs apart', () => {
    const adf = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }, { type: 'text', text: ' line' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ],
    };
    expect(adfToText(adf)).toBe('First line Second');
  });
});

describe('tokenize', () => {
  it('lower-cases and removes stopwords and generic support words', () => {
    expect(tokenize('The Login PAGE shows an error message')).toEqual(['login', 'page']);
  });

  it('keeps three-digit codes such as HTTP statuses and drops other numbers', () => {
    expect(tokenize('returning 503 for 30 percent of 2024 logins')).toEqual(['returning', '503', 'percent', 'login']);
  });

  it('stems plurals so singular and plural forms match', () => {
    expect(tokenize('failures connections policies')).toEqual(['failure', 'connection', 'policy']);
  });

  it('does not strip a double s', () => {
    expect(tokenize('access')).toEqual(['access']);
  });

  it('handles empty and missing input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(undefined as unknown as string)).toEqual([]);
  });
});

describe('extractKeywords', () => {
  it('weights summary keywords above description keywords', () => {
    const kw = extractKeywords('VPN timeout', 'connection drops at home');
    expect(kw.get('vpn')).toBe(SUMMARY_KEYWORD_WEIGHT);
    expect(kw.get('timeout')).toBe(SUMMARY_KEYWORD_WEIGHT);
    expect(kw.get('connection')).toBe(1);
  });

  it('keeps the summary weight when a word repeats in the description', () => {
    expect(extractKeywords('VPN down', 'the vpn client fails').get('vpn')).toBe(SUMMARY_KEYWORD_WEIGHT);
  });

  const manyWords = Array.from({ length: 60 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}${i}x`).join(' ');

  it('caps the number of keywords from the description', () => {
    expect(extractKeywords('', manyWords).size).toBe(MAX_TICKET_KEYWORDS);
  });

  it('caps the number of keywords from a very long summary, leaving no room for the description', () => {
    const kw = extractKeywords(manyWords, 'vpn');
    expect(kw.size).toBe(MAX_TICKET_KEYWORDS);
    expect(kw.has('vpn')).toBe(false);
    expect([...kw.values()].every((w) => w === SUMMARY_KEYWORD_WEIGHT)).toBe(true);
  });
});

describe('keywordOverlap', () => {
  it('is 0 when the ticket has no keywords', () => {
    expect(keywordOverlap(new Map(), 'anything')).toBe(0);
  });

  it('is the weighted fraction of keywords found', () => {
    const kw = new Map([['vpn', 2], ['laptop', 1], ['home', 1]]);
    expect(keywordOverlap(kw, 'VPN gateway down for remote workers at home')).toBeCloseTo(3 / 4);
  });

  it('is 1 when every keyword is present', () => {
    const kw = new Map([['vpn', 2]]);
    expect(keywordOverlap(kw, 'vpn')).toBe(1);
  });
});

describe('mapIncidentStatus (demo site incident workflow)', () => {
  it('drops cancelled incidents', () => {
    expect(mapIncidentStatus('Cancelled', 'done')).toBeNull();
  });

  it('maps Pending to monitoring', () => {
    expect(mapIncidentStatus('Pending', 'indeterminate')).toBe('monitoring');
  });

  it('maps done-category statuses to resolved', () => {
    expect(mapIncidentStatus('Completed', 'done')).toBe('resolved');
    expect(mapIncidentStatus('Closed', 'done')).toBe('resolved');
  });

  it('maps open and in-progress statuses to active', () => {
    expect(mapIncidentStatus('Open', 'new')).toBe('active');
    expect(mapIncidentStatus('Work in progress', 'indeterminate')).toBe('active');
  });

  it('accepts the American spelling and ignores case and whitespace', () => {
    expect(mapIncidentStatus('  CANCELED ', 'done')).toBeNull();
  });

  it('treats a missing status name as active unless the category is done', () => {
    expect(mapIncidentStatus(undefined as unknown as string, 'new')).toBe('active');
    expect(mapIncidentStatus(undefined as unknown as string, 'done')).toBe('resolved');
  });
});

describe('pickResolutionComment', () => {
  const agent = (text: string, extra: Partial<ResolutionCommentCandidate> = {}): ResolutionCommentCandidate => ({
    text,
    isPublic: true,
    isHumanAgent: true,
    byRequester: false,
    ...extra,
  });

  it('picks the fix over a newer sign-off (demo site ITS-6258)', () => {
    const comments = [
      agent("Thanks for confirming, Emma! If there's anything else you need, just give us a shout."),
      agent('That worked! Thank you, you can close this out.', { byRequester: true }),
      agent('Hello Emma, Thank you for contacting our IT support service desk. We reset the VPN today. The simplest solution is to shut down your phone and restart it.'),
    ];
    expect(pickResolutionComment(comments)).toContain('We reset the VPN today');
  });

  it('skips automation, internal and requester comments', () => {
    const comments = [
      agent('Root cause: certificate expired. Resolution: renewed it.', { isHumanAgent: false }),
      agent('Root cause: certificate expired. Resolution: renewed it internally.', { isPublic: false }),
      agent('Root cause: I restarted it myself and it was fixed.', { byRequester: true }),
    ];
    expect(pickResolutionComment(comments)).toBe('');
  });

  it('skips short acknowledgements even when they mention a fix term', () => {
    expect(pickResolutionComment([agent('Fixed, thanks!')])).toBe('');
  });

  it('returns empty when no eligible comment describes a fix', () => {
    expect(pickResolutionComment([agent('Thanks for your patience while we look into this for you today.')])).toBe('');
  });

  it('prefers the comment with more distinct fix terms', () => {
    const comments = [
      agent('We restarted the service and it came back after a few minutes of waiting.'),
      agent('Root cause: config change to the sync worker pool. Resolution: reverted the change and restarted.'),
    ];
    expect(pickResolutionComment(comments)).toContain('Root cause');
  });

  it('keeps the best comment when a later one has fewer fix terms', () => {
    const best = agent('Root cause: config change to the sync worker pool. Resolution: reverted the change and restarted.');
    const weaker = agent('We restarted the service and it came back after a few minutes of waiting.');
    expect(pickResolutionComment([best, weaker])).toBe(best.text);
  });

  it('keeps the earlier comment on a full tie', () => {
    const first = agent('We had to reset the VPN connection for your account, first.');
    const second = agent('We had to reset the VPN connection for your account, again.');
    expect(pickResolutionComment([first, second])).toBe(first.text);
  });

  it('breaks ties by length', () => {
    const shorter = agent('We had to reset the VPN connection for your account.');
    const longer = agent('We had to reset the VPN connection for your account and then confirm the tunnel came back.');
    expect(pickResolutionComment([shorter, longer])).toBe(longer.text);
  });

  it('normalizes whitespace in the returned text', () => {
    expect(pickResolutionComment([agent('Root   cause:\n expired certificate, renewed  and reloaded nginx.')])).toBe(
      'Root cause: expired certificate, renewed and reloaded nginx.',
    );
  });
});

describe('excerpt', () => {
  it('returns short text unchanged', () => {
    expect(excerpt('short text', 50)).toBe('short text');
  });

  it('cuts at a word boundary and marks the cut', () => {
    expect(excerpt('alpha beta gamma delta epsilon', 18)).toBe('alpha beta gamma…');
  });

  it('cuts mid-word when the last space is too early to keep a useful excerpt', () => {
    expect(excerpt('a supercalifragilisticexpialidocious', 20)).toBe('a supercalifragilist…');
  });

  it('collapses whitespace and handles missing text', () => {
    expect(excerpt('  spaced \n\n out  ', 50)).toBe('spaced out');
    expect(excerpt(undefined as unknown as string, 50)).toBe('');
  });
});

describe('relevance regression (demo site texts)', () => {
  const loginTicket = extractKeywords(
    'Cannot log in - getting error on login page',
    "I'm unable to log in to my account. When I enter my credentials, the page shows a generic error message. " +
      "This started about 30 minutes ago. I've tried clearing cache and a different browser - same result.",
  );

  it('matches the active login incident above the cutoff', () => {
    const incident =
      'Login service is experiencing intermittent failures. Users across multiple regions are reporting inability to log in ' +
      'and see a generic error message on the login page. The auth service is returning 503 errors.';
    expect(keywordOverlap(loginTicket, incident)).toBeGreaterThanOrEqual(MIN_SYMPTOM_OVERLAP);
  });

  it('does not match an unrelated sync ticket that shares only "error message"', () => {
    const syncTicket =
      'Dashloop error: Sync failed due to network issues. I\'m having an issue with syncing across my devices. ' +
      'The error message says, "Sync failed due to network issues." The error message should not appear during the sync process.';
    expect(keywordOverlap(loginTicket, syncTicket)).toBeLessThan(MIN_SYMPTOM_OVERLAP);
  });

  it('does not match the database incident', () => {
    const dbIncident =
      'Database connection pool exhausted on primary DB cluster. Applications dependent on db-primary are failing with ' +
      'too many connections errors and dashboards are loading slowly.';
    expect(keywordOverlap(loginTicket, dbIncident)).toBeLessThan(MIN_SYMPTOM_OVERLAP);
  });
});
