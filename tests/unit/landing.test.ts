import { describe, expect, it } from 'vitest';
import { LANDING_PAIRS, landingCopy, pairFromPath } from '../../src/core/landing';
import { canConvert } from '../../src/core/routes';

describe('landing pages', () => {
  it('only lists conversions the app can actually do', () => {
    for (const [from, to] of LANDING_PAIRS) expect(canConvert(from, to), `${from} → ${to}`).toBe(true);
    expect(new Set(LANDING_PAIRS.map((p) => p.join('>'))).size).toBe(LANDING_PAIRS.length);
  });

  it('reads the pair from the path, with or without a trailing slash', () => {
    expect(pairFromPath('/decant/heic-to-jpg/', '/decant/')).toEqual({ from: 'heic', to: 'jpg' });
    expect(pairFromPath('/decant/HEIC-to-JPG', '/decant/')).toEqual({ from: 'heic', to: 'jpg' });
    expect(pairFromPath('/mp4-to-gif/', '/')).toEqual({ from: 'mp4', to: 'gif' });
  });

  it('ignores paths that are not real conversions', () => {
    expect(pairFromPath('/decant/', '/decant/')).toBeNull();
    expect(pairFromPath('/decant/jpg-to-jpg/', '/decant/')).toBeNull();
    expect(pairFromPath('/decant/pdf-to-docx/', '/decant/')).toBeNull();
    expect(pairFromPath('/decant/exe-to-jpg/', '/decant/')).toBeNull();
    expect(pairFromPath('/decant/heic-to-jpg/extra', '/decant/')).toBeNull();
  });

  it('writes a title and description for each page', () => {
    expect(landingCopy('heic', 'jpg').title).toBe('Convert HEIC to JPG without uploading | Decant');
    expect(landingCopy('csv', 'xlsx').description).toMatch(/^Convert CSV to XLSX in your browser/);
  });
});
