// Acceptance (spec Phase 5.5): no hardcoded project keys or field IDs remain in source; the settings page is
// the only place they are set. Scans app code (not tests, not comments) for custom field IDs and for
// project keys written as string literals. Example issue keys in messages ("ITS-123") are allowed.
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sourceFiles(path);
    return /\.(ts|tsx|jsx)$/.test(name) ? [path] : [];
  });
}

/** Code lines only: line comments and block-comment lines are dropped. */
const codeLines = (path: string) =>
  readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line, n) => ({ line, n: n + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .map(({ line, n }) => ({ line: line.replace(/\s\/\/.*$/, ''), n }));

describe('no hardcoded site configuration (spec Phase 5.5)', () => {
  const files = sourceFiles(SRC);

  it('scans the app source', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no custom field IDs in code', () => {
    const hits = files.flatMap((f) => codeLines(f).filter(({ line }) => /customfield_\d+/.test(line)).map(({ n }) => `${f}:${n}`));
    expect(hits).toEqual([]);
  });

  it('has no project keys as string literals in code (the demo site\'s ITS and ITO included)', () => {
    const literal = /(['"`])(ITS|ITO|SUP|INC)\1/;
    const hits = files.flatMap((f) => codeLines(f).filter(({ line }) => literal.test(line)).map(({ n }) => `${f}:${n}`));
    expect(hits).toEqual([]);
  });
});
