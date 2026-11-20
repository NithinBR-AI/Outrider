import { ContextBundle } from '../domain/types';

export async function getTicketContext(ticketKey: string): Promise<ContextBundle> {
  return {
    ticketKey,
    builtAt: new Date().toISOString(),
    buildId: 'stub',
    ticketFingerprint: 'stub',
    incidents: [],
    resolutions: [],
    articles: [],
    services: [],
    partial: false,
    failures: [],
  };
}
