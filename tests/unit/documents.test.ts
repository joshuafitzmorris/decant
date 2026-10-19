// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { htmlToText } from '../../src/engines/docs/html';
import { htmlToMarkdown } from '../../src/engines/docs/index';
import { joinTextItems } from '../../src/engines/pdf/index';

describe('htmlToText', () => {
  it('turns blocks into paragraphs and lists into bullet lines', () => {
    const html =
      '<h1>Title</h1><p>Hello <b>world</b>.</p><ul><li>One</li><li>Two</li></ul><ol start="3"><li>Three</li></ol>';
    expect(htmlToText(html)).toBe('Title\n\nHello world.\n\n• One\n• Two\n\n3. Three\n');
  });

  it('keeps table rows on one line with tabs between cells', () => {
    const html =
      '<table><tr><td><p>Format</p></td><td><p>Kind</p></td></tr><tr><td>HEIC</td><td>Image</td></tr></table>';
    expect(htmlToText(html)).toBe('Format\tKind\nHEIC\tImage\n');
  });

  it('collapses source whitespace but keeps line breaks and preformatted text', () => {
    const html = '<p>  a\n   b<br>c  </p><pre>x\n  y</pre>';
    expect(htmlToText(html)).toBe('a b\nc\n\nx\n  y\n');
  });

  it('skips scripts and styles', () => {
    expect(htmlToText('<style>p{}</style><script>alert(1)</script><p>Visible</p>')).toBe('Visible\n');
  });

  it('indents nested lists', () => {
    expect(htmlToText('<ul><li>Outer<ul><li>Inner</li></ul></li></ul>')).toBe('• Outer\n  • Inner\n');
  });
});

describe('htmlToMarkdown', () => {
  it('writes compact lists and GitHub-style tables', async () => {
    const html = '<h2>Formats</h2><ul><li>First</li><li>Second</li></ul><ol><li>One</li><li>Two</li></ol>';
    expect(await htmlToMarkdown(html)).toBe('## Formats\n\n- First\n- Second\n\n1. One\n2. Two\n');
  });

  it('promotes a table’s first row to its header, as Word tables have none', async () => {
    const html =
      '<table><tr><td><p><strong>Format</strong></p></td><td><p><strong>Kind</strong></p></td></tr><tr><td><p>HEIC</p></td><td><p>Image</p></td></tr></table>';
    expect(await htmlToMarkdown(html)).toBe('| Format | Kind |\n| --- | --- |\n| HEIC | Image |\n');
  });

  it('keeps links and emphasis', async () => {
    expect(
      await htmlToMarkdown('<p>A <a href="https://example.com">link</a>, <em>soft</em> and <strong>loud</strong>.</p>'),
    ).toBe('A [link](https://example.com), *soft* and **loud**.\n');
  });
});

describe('PDF text', () => {
  it('starts a new line when the baseline moves, without doubling breaks', () => {
    const items = [
      { str: 'Hello', transform: [1, 0, 0, 1, 0, 700], hasEOL: false },
      { str: ' world', transform: [1, 0, 0, 1, 40, 700], hasEOL: true },
      { str: '', transform: [1, 0, 0, 1, 0, 700], hasEOL: true },
      { str: 'Next line', transform: [1, 0, 0, 1, 0, 680], hasEOL: false },
    ];
    expect(joinTextItems(items)).toBe('Hello world\nNext line');
  });
});
