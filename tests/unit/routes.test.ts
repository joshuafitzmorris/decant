import { describe, expect, it } from 'vitest';
import { FORMATS, type FormatId, getFormat, isFormatId } from '../../src/core/formats';
import { groupOptionDefs, groupTargets } from '../../src/core/groups';
import { defaultOptions, optionsFor, parseTime } from '../../src/core/options';
import { canConvert, engineFor, readableFormats, targetsFor } from '../../src/core/routes';

const sources = readableFormats();

describe('routes', () => {
  it('every readable format offers at least one target', () => {
    for (const from of sources) expect(targetsFor(from).length, from).toBeGreaterThan(0);
  });

  it('never offers a format as a target for itself, or twice', () => {
    for (const from of sources) {
      const targets = targetsFor(from);
      expect(targets, from).not.toContain(from);
      expect(new Set(targets).size, from).toBe(targets.length);
    }
  });

  it('only routes to real formats, each handled by an engine', () => {
    for (const from of sources) {
      for (const to of targetsFor(from)) {
        expect(isFormatId(to), `${from} → ${to}`).toBe(true);
        expect(['image', 'media', 'pdf', 'docs', 'data']).toContain(engineFor(from, to));
      }
    }
  });

  it('sends each kind of conversion to the right engine', () => {
    expect(engineFor('heic', 'jpg')).toBe('image');
    expect(engineFor('png', 'pdf')).toBe('pdf');
    expect(engineFor('gif', 'mp4')).toBe('media');
    expect(engineFor('mov', 'gif')).toBe('media');
    expect(engineFor('pdf', 'png')).toBe('pdf');
    expect(engineFor('docx', 'md')).toBe('docs');
    expect(engineFor('csv', 'xlsx')).toBe('data');
  });

  it('has unique extensions across formats', () => {
    const seen = new Map<string, string>();
    for (const format of FORMATS) {
      for (const ext of format.exts) {
        expect(seen.get(ext), `.${ext} claimed twice`).toBeUndefined();
        seen.set(ext, format.id);
      }
    }
  });

  it('canConvert agrees with targetsFor', () => {
    expect(canConvert('heic', 'jpg')).toBe(true);
    expect(canConvert('jpg', 'jpg')).toBe(false);
    expect(canConvert('pdf', 'docx')).toBe(false);
  });
});

describe('groups', () => {
  it('uses a single source format’s own order', () => {
    expect(groupTargets('image', ['heic'])[0]).toBe('jpg');
    expect(groupTargets('image', ['jpg'])[0]).toBe('png');
  });

  it('orders a mixed group by popularity and includes every reachable target', () => {
    const targets = groupTargets('image', ['jpg', 'png', 'heic']);
    expect(targets[0]).toBe('jpg');
    expect(targets).toContain('png');
    expect(targets).toContain('ico');
  });

  it('merges option definitions without duplicates', () => {
    const defs = groupOptionDefs(['png', 'heic', 'jpg'] as FormatId[], 'jpg');
    const keys = defs.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining(['quality', 'size', 'background']));
  });
});

describe('options', () => {
  it('gives every route unique option keys with valid defaults', () => {
    for (const from of sources) {
      for (const to of targetsFor(from)) {
        const defs = optionsFor(from, to);
        const keys = defs.map((d) => d.key);
        expect(new Set(keys).size, `${from} → ${to}`).toBe(keys.length);
        for (const def of defs) {
          if (def.kind === 'select')
            expect(
              def.choices.map((c) => c.value),
              `${from} → ${to} ${def.key}`,
            ).toContain(def.default);
          if (def.kind === 'range') expect(def.default).toBeGreaterThanOrEqual(def.min);
        }
        expect(Object.keys(defaultOptions(from, to))).toEqual(keys);
      }
    }
  });

  it('only shows a background colour when transparency could need filling', () => {
    expect(optionsFor('png', 'jpg').map((d) => d.key)).toContain('background');
    expect(optionsFor('png', 'webp').map((d) => d.key)).not.toContain('background');
  });

  it.each([
    ['', undefined],
    ['  ', undefined],
    ['12', 12],
    ['12.5', 12.5],
    ['1:05', 65],
    ['01:02:03', 3723],
    ['1:2:3:4', undefined],
    ['abc', undefined],
    ['-3', undefined],
  ])('parseTime(%j) → %j', (input, expected) => {
    expect(parseTime(input)).toBe(expected);
  });

  it('names every format', () => {
    for (const format of FORMATS) expect(getFormat(format.id as FormatId).label.length).toBeGreaterThan(0);
  });
});
