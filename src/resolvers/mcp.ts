import { getTicketContext as getTicketContextImpl } from '../mcp/tools';

export async function getTicketContext(req: Record<string, unknown>) {
  const ticketKey = (req.ticketKey ?? (req.payload as Record<string, unknown>)?.ticketKey) as string | undefined;
  if (!ticketKey) {
    throw new Error('ticketKey is required');
  }
  return getTicketContextImpl(ticketKey);
}
