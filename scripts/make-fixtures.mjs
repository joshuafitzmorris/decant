#!/usr/bin/env node
/**
 * Generates the small sample files used by the end-to-end tests.
 * Needs ffmpeg on PATH; HEIC, WebP and DOCX samples also need macOS (sips, textutil).
 * Output is committed, so this only has to run when fixtures change.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as XLSX from 'xlsx';

const out = join(import.meta.dirname, '..', 'tests', 'fixtures');
const tmp = join(out, '.tmp');
mkdirSync(tmp, { recursive: true });

const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const tryRun = (label, fn) => {
  try {
    fn();
  } catch (error) {
    console.warn(`skipped ${label}: ${error.message.split('\n')[0]}`);
  }
};
const at = (name) => join(out, name);

// --- Images -----------------------------------------------------------------
// A 96×64 frame with a transparent corner, so alpha handling gets exercised.
ff(
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=96x64:rate=1',
  '-frames:v',
  '1',
  '-vf',
  "format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(X,24)*lt(Y,16),0,255)'",
  at('sample.png'),
);
ff('-i', at('sample.png'), '-q:v', '3', at('sample.jpg'));
ff('-i', at('sample.png'), at('sample.bmp'));
ff('-i', at('sample.png'), '-compression_algo', 'lzw', at('sample.tiff'));
ff('-i', at('sample.png'), '-vf', 'scale=32:32', at('sample.ico'));
ff(
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=96x64:rate=8:duration=1',
  '-vf',
  'split[a][b];[a]palettegen[p];[b][p]paletteuse',
  '-loop',
  '0',
  at('sample.gif'),
);
tryRun('avif', () =>
  ff('-i', at('sample.png'), '-c:v', 'libsvtav1', '-frames:v', '1', '-pix_fmt', 'yuv420p', at('sample.avif')),
);
tryRun('heic', () =>
  execFileSync('sips', ['-s', 'format', 'heic', at('sample.jpg'), '--out', at('sample.heic')], { stdio: 'ignore' }),
);
tryRun('webp', () =>
  execFileSync('sips', ['-s', 'format', 'webp', at('sample.png'), '--out', at('sample.webp')], { stdio: 'ignore' }),
);
writeFileSync(
  at('sample.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><rect width="120" height="80" rx="12" fill="#1e6b52"/><circle cx="40" cy="40" r="22" fill="#f2c94c"/><path d="M70 58 92 22l12 36z" fill="#fff"/></svg>\n`,
);

// --- Audio --------------------------------------------------------------------
const tone = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=1.5', '-ac', '2'];
ff(...tone, '-c:a', 'pcm_s16le', at('sample.wav'));
ff(...tone, '-c:a', 'libmp3lame', '-b:a', '128k', at('sample.mp3'));
ff(...tone, '-c:a', 'flac', at('sample.flac'));
ff(...tone, '-c:a', 'aac', '-b:a', '128k', at('sample.m4a'));
ff(...tone, '-c:a', 'aac', '-b:a', '128k', '-f', 'adts', at('sample.aac'));
ff(...tone, '-c:a', 'libopus', '-b:a', '96k', at('sample.opus'));
tryRun('ogg', () => ff(...tone, '-c:a', 'vorbis', '-strict', '-2', '-ac', '2', at('sample.ogg')));
ff(...tone, '-c:a', 'pcm_s16be', at('sample.aiff'));
ff(...tone, '-c:a', 'wmav2', '-b:a', '128k', at('sample.wma'));

// --- Video --------------------------------------------------------------------
const clip = [
  '-f',
  'lavfi',
  '-i',
  'testsrc2=size=160x90:rate=15:duration=1.5',
  '-f',
  'lavfi',
  '-i',
  'sine=frequency=330:sample_rate=48000:duration=1.5',
  '-shortest',
];
ff(...clip, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', at('sample.mp4'));
ff(...clip, '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', at('sample.mov'));
ff(...clip, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-c:a', 'libopus', at('sample.webm'));
ff(...clip, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'ac3', at('sample.mkv'));
ff(...clip, '-c:v', 'mpeg4', '-c:a', 'libmp3lame', at('sample.avi'));
ff(...clip, '-c:v', 'wmv2', '-c:a', 'wmav2', at('sample.wmv'));
ff(...clip, '-c:v', 'flv', '-c:a', 'libmp3lame', '-ar', '44100', at('sample.flv'));
ff(...clip, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-f', 'mpegts', at('sample.m2ts'));
ff(...clip, '-c:v', 'mpeg2video', '-c:a', 'mp2', '-f', 'mpeg', at('sample.mpg'));
ff(...clip, '-c:v', 'h263', '-s', '176x144', '-c:a', 'aac', '-ar', '16000', '-ac', '1', at('sample.3gp'));

// --- Documents ----------------------------------------------------------------
const markdown = `# Decant sample

A short document with **bold**, *italic* and a [link](https://example.com).

- First item
- Second item

| Format | Kind |
| --- | --- |
| HEIC | Image |
| FLAC | Audio |

\`\`\`js
console.log('hello');
\`\`\`
`;
writeFileSync(at('sample.md'), markdown);
writeFileSync(at('sample.txt'), 'Decant sample\n\nPlain text, two paragraphs.\nWith a line break.\n');
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Decant sample</title></head><body>
<h1>Decant sample</h1><p>A short document with <strong>bold</strong>, <em>italic</em> and a <a href="https://example.com">link</a>.</p>
<ul><li>First item</li><li>Second item</li></ul>
<table><tr><th>Format</th><th>Kind</th></tr><tr><td>HEIC</td><td>Image</td></tr><tr><td>FLAC</td><td>Audio</td></tr></table>
</body></html>\n`;
writeFileSync(at('sample.html'), html);
const cell = (text, bold = false) =>
  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold })] })] });
const word = new Document({
  numbering: {
    config: [{ reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.' }] }],
  },
  sections: [
    {
      children: [
        new Paragraph({ text: 'Decant sample', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({
          children: [
            new TextRun('A short document with '),
            new TextRun({ text: 'bold', bold: true }),
            new TextRun(', '),
            new TextRun({ text: 'italic', italics: true }),
            new TextRun(' and a '),
            new ExternalHyperlink({
              link: 'https://example.com',
              children: [new TextRun({ text: 'link', style: 'Hyperlink' })],
            }),
            new TextRun('.'),
          ],
        }),
        new Paragraph({ text: 'Formats', heading: HeadingLevel.HEADING_2 }),
        new Paragraph({ text: 'First item', bullet: { level: 0 } }),
        new Paragraph({ text: 'Second item', bullet: { level: 0 } }),
        new Paragraph({ text: 'Step one', numbering: { reference: 'steps', level: 0 } }),
        new Paragraph({ text: 'Step two', numbering: { reference: 'steps', level: 0 } }),
        new Table({
          rows: [
            new TableRow({ children: [cell('Format', true), cell('Kind', true)] }),
            new TableRow({ children: [cell('HEIC'), cell('Image')] }),
            new TableRow({ children: [cell('FLAC'), cell('Audio')] }),
          ],
        }),
      ],
    },
  ],
});
writeFileSync(at('sample.docx'), await Packer.toBuffer(word));

const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const [i, line] of ['Decant sample, page one.', 'And this is page two.'].entries()) {
  const page = pdf.addPage([300, 200]);
  page.drawRectangle({ x: 20, y: 20, width: 260, height: 40, color: rgb(0.12, 0.42, 0.32) });
  page.drawText(line, { x: 20, y: 150, size: 14, font });
  page.drawText(`Page ${i + 1}`, { x: 20, y: 120, size: 10, font });
}
writeFileSync(at('sample.pdf'), await pdf.save());

// --- Data ---------------------------------------------------------------------
const rows = [
  { name: 'Ada', role: 'Engineer', joined: '2021-04-01', score: 92.5 },
  { name: 'Grace', role: 'Admiral', joined: '2019-11-15', score: 88 },
  { name: 'Linus', role: 'Maintainer', joined: '2020-02-29', score: 79.25 },
];
writeFileSync(at('sample.json'), `${JSON.stringify(rows, null, 2)}\n`);
writeFileSync(
  at('sample.csv'),
  `name,role,joined,score\n${rows.map((r) => [r.name, r.role, r.joined, r.score].join(',')).join('\n')}\n`,
);
writeFileSync(
  at('sample.tsv'),
  `name\trole\tjoined\tscore\n${rows.map((r) => [r.name, r.role, r.joined, r.score].join('\t')).join('\n')}\n`,
);
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'People');
XLSX.utils.book_append_sheet(
  book,
  XLSX.utils.aoa_to_sheet([
    ['metric', 'value'],
    ['total', 3],
  ]),
  'Summary',
);
writeFileSync(at('sample.xlsx'), XLSX.write(book, { bookType: 'xlsx', type: 'buffer' }));
writeFileSync(at('sample.xls'), XLSX.write(book, { bookType: 'biff8', type: 'buffer' }));
writeFileSync(at('sample.ods'), XLSX.write(book, { bookType: 'ods', type: 'buffer' }));
writeFileSync(
  at('sample.yaml'),
  'service: decant\nversion: 1\nfeatures:\n  - images\n  - audio\nlimits:\n  maxFiles: 50\n  offline: true\n',
);
writeFileSync(
  at('sample.toml'),
  'service = "decant"\nversion = 1\nfeatures = ["images", "audio"]\n\n[limits]\nmaxFiles = 50\noffline = true\n',
);
writeFileSync(
  at('sample.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<service name="decant">\n  <version>1</version>\n  <feature>images</feature>\n  <feature>audio</feature>\n</service>\n',
);

if (existsSync(tmp)) rmSync(tmp, { recursive: true });
console.log(`Fixtures written to ${out}`);
