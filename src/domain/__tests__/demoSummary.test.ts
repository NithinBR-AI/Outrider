// The canned demo summary (spec §13.6) must keep the shape the demo relies on.
import { describe, expect, it } from 'vitest';
import { DEMO_SUMMARIES, demoSummaryFor } from '../demoSummary';

describe('demo summary fixture', () => {
  it('exists only for the primary demo ticket', () => {
    expect(Object.keys(DEMO_SUMMARIES)).toEqual(['ITS-6265']);
    expect(demoSummaryFor('ITS-6265')).toBe(DEMO_SUMMARIES['ITS-6265']);
    expect(demoSummaryFor('ITS-1')).toBeUndefined();
  });

  it('is marked as a fixture', () => {
    expect(demoSummaryFor('ITS-6265')!.origin).toBe('demo-fixture');
  });

  it('has a deliberately unsupported claim citing a source, and an uncited claim', () => {
    const claims = demoSummaryFor('ITS-6265')!.generatedClaims;
    expect(claims.find((c) => c.claimId === 'demo-4-unsupported')!.citedSourceRef).not.toBeNull();
    expect(claims.find((c) => c.claimId === 'demo-5-uncited')!.citedSourceRef).toBeNull();
    expect(new Set(claims.map((c) => c.claimId)).size).toBe(claims.length);
  });
});
