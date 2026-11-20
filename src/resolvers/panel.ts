import Resolver from '@forge/resolver';
import { fetchConfluencePage } from '../adapters/confluence';

const resolver = new Resolver();

resolver.define('getText', async (req) => {
  console.log(req);
  try {
    const page = await fetchConfluencePage();
    return `Outrider online. Confluence connected: ${page}`;
  } catch (e) {
    console.error('Confluence read failed:', e);
    return 'Outrider online. Confluence: not connected yet.';
  }
});

export const panelResolver = resolver.getDefinitions();
