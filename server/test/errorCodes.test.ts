/**
 * The one invariant that spans both workspaces: **every refusal the API can
 * hand back has a sentence in each language.**
 *
 * TypeScript cannot enforce it — `server/` and `web/` are separate packages and
 * the code is a string on the wire — so it is enforced by reading the web
 * dictionary from here. Crude, and the only thing that actually holds the two
 * halves together: without it, adding a route with a new refusal would ship a
 * German page that answers in English, silently, and nothing would fail.
 *
 * The frontend falls back to the English sentence for a code it does not know
 * (`i18n.tsx`), so a gap is never *broken* — just untranslated. That is exactly
 * the kind of thing nobody notices without a test.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/errorCodes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dictionary = fs.readFileSync(
  path.join(here, '..', '..', 'web', 'src', 'strings.ts'),
  'utf8',
);

describe('error codes', () => {
  it('has a translation for every code the API can return', () => {
    const missing = ERROR_CODES.filter((code) => !dictionary.includes(`'${code}':`));
    expect(missing).toEqual([]);
  });

  it('does not carry entries for codes nothing can return', () => {
    // The other direction: a dictionary entry with no code behind it is dead
    // weight that reads as coverage. Renaming a code should fail here too.
    const declared = [...dictionary.matchAll(/'(error\.[A-Za-z]+)':/g)].map((m) => m[1]);
    const orphaned = declared.filter((key) => !(ERROR_CODES as readonly string[]).includes(key));
    expect(orphaned).toEqual([]);
  });

  it('lists each code once', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});
