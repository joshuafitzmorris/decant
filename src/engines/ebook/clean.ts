import { parseChapter, serializeChildren } from './book';

/** Elements and the attributes worth keeping on them; anything else is unwrapped (its text stays). */
const ALLOWED: Record<string, string[]> = {
  a: ['href'],
  abbr: ['title'],
  b: [],
  bdi: [],
  bdo: ['dir'],
  blockquote: [],
  br: [],
  caption: [],
  cite: [],
  code: [],
  dd: [],
  del: [],
  dfn: [],
  div: ['align'],
  dl: [],
  dt: [],
  em: [],
  figcaption: ['align'],
  figure: [],
  h1: ['align'],
  h2: ['align'],
  h3: ['align'],
  h4: ['align'],
  h5: ['align'],
  h6: ['align'],
  hr: [],
  i: [],
  img: ['src', 'alt'],
  ins: [],
  kbd: [],
  li: [],
  mark: [],
  ol: ['start', 'type'],
  p: ['align'],
  pre: [],
  q: [],
  s: [],
  samp: [],
  small: [],
  span: [],
  strong: [],
  sub: [],
  sup: [],
  table: [],
  tbody: [],
  td: ['align', 'colspan', 'rowspan'],
  tfoot: [],
  th: ['align', 'colspan', 'rowspan'],
  thead: [],
  tr: [],
  u: [],
  ul: [],
  var: [],
  // HTML5 sectioning becomes plain divisions: the writers only care about the content.
  section: [],
  article: [],
  aside: [],
  header: [],
  footer: [],
  main: [],
  nav: [],
};
const RENAME: Record<string, string> = {
  section: 'div',
  article: 'div',
  aside: 'div',
  header: 'div',
  footer: 'div',
  main: 'div',
  nav: 'div',
  center: 'div',
  strike: 's',
  tt: 'code',
  big: 'span',
  listing: 'pre',
  xmp: 'pre',
};
const DROP = new Set([
  'script',
  'style',
  'link',
  'meta',
  'title',
  'head',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'noscript',
  'canvas',
  'template',
  'audio',
  'video',
  'source',
  'track',
  'map',
  'area',
]);
const GLOBAL_ATTRIBUTES = ['id', 'dir', 'lang'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

export interface CleanOptions {
  /** Maps a link target to a chapter href ("chapter-2.xhtml#x") or external URL; null drops the link. */
  link: (href: string) => string | null;
  /** Maps an image source to a resource href; null drops the image. */
  image: (src: string) => Promise<string | null> | string | null;
}

/** Turns a source document's body into the simplified XHTML a Chapter holds. */
export async function cleanBody(doc: Document, body: Element, options: CleanOptions): Promise<string> {
  // SVG wrappers around a single picture (a common cover pattern) become plain images.
  for (const svg of Array.from(body.getElementsByTagNameNS(SVG_NS, 'svg'))) {
    const images = svg.getElementsByTagNameNS(SVG_NS, 'image');
    const picture = images.length === 1 ? images[0] : null;
    const href = picture?.getAttributeNS(XLINK_NS, 'href') ?? picture?.getAttribute('href');
    if (href) {
      const img = doc.createElementNS(body.namespaceURI, 'img');
      img.setAttribute('src', href);
      img.setAttribute('alt', '');
      svg.replaceWith(img);
    } else svg.remove();
  }

  const used = new Set<string>();
  await walk(doc, body, options, used);
  return serializeChildren(body);
}

async function walk(doc: Document, element: Element, options: CleanOptions, used: Set<string>) {
  for (const child of Array.from(element.children)) {
    const name = child.localName.toLowerCase();
    if (DROP.has(name) || child.namespaceURI === SVG_NS) {
      child.remove();
      continue;
    }
    let node = child;
    const renamed = RENAME[name];
    if (renamed || name !== child.localName) node = rename(doc, child, renamed ?? name);
    const tag = node.localName;
    const allowed = ALLOWED[tag];

    if (!allowed) {
      // Unknown or vendor markup (<font>, <mbp:nu>...): keep what's inside.
      await walk(doc, node, options, used);
      node.replaceWith(...Array.from(node.childNodes));
      continue;
    }

    for (const attr of Array.from(node.attributes)) {
      const keep = attr.namespaceURI === null && (allowed.includes(attr.name) || GLOBAL_ATTRIBUTES.includes(attr.name));
      if (!keep) node.removeAttributeNode(attr);
    }
    const id = node.getAttribute('id');
    if (id !== null) {
      if (!id || used.has(id)) node.removeAttribute('id');
      else used.add(id);
    }

    if (tag === 'a') {
      const href = node.getAttribute('href');
      const target = href ? options.link(href) : null;
      if (target) node.setAttribute('href', target);
      else node.removeAttribute('href');
    } else if (tag === 'img') {
      const src = node.getAttribute('src');
      const target = src ? await options.image(src) : null;
      if (!target) {
        const alt = node.getAttribute('alt');
        node.replaceWith(...(alt ? [doc.createTextNode(alt)] : []));
        continue;
      }
      node.setAttribute('src', target);
      if (!node.hasAttribute('alt')) node.setAttribute('alt', '');
    }
    await walk(doc, node, options, used);
  }
}

function rename(doc: Document, element: Element, name: string): Element {
  const replacement = doc.createElementNS(element.namespaceURI, name);
  for (const attr of Array.from(element.attributes)) {
    if (attr.namespaceURI === null) replacement.setAttribute(attr.name, attr.value);
  }
  while (element.firstChild) replacement.append(element.firstChild);
  element.replaceWith(replacement);
  return replacement;
}

/** The first heading's text, used as a chapter title when the book doesn't name its chapters. */
export function firstHeading(body: Element): string | undefined {
  const heading = body.querySelector('h1, h2, h3');
  const text = heading?.textContent?.replace(/\s+/g, ' ').trim();
  return text || undefined;
}

/** Splits "path/to/file.xhtml#frag" into its parts. */
export function splitHref(href: string): [path: string, fragment: string] {
  const hash = href.indexOf('#');
  return hash < 0 ? [href, ''] : [href.slice(0, hash), href.slice(hash + 1)];
}

/** Resolves a relative URL against the directory of `base` inside an archive. */
export function resolvePath(base: string, relative: string): string {
  const clean = decodeURIComponentSafe(relative.split(/[?#]/)[0] ?? '');
  if (clean.startsWith('/')) return clean.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const part of clean.split('/')) {
    if (part === '..') parts.pop();
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const isExternal = (href: string) => /^(https?|mailto|ftp):/i.test(href);

/** Unwraps links to chapters that were left out (empty sections, a source's own contents page). */
export function unlinkMissing(html: string, kept: Set<string>): string {
  if (!html.includes('href="chapter-')) return html;
  const body = parseChapter(html).body;
  let changed = false;
  for (const a of Array.from(body.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    const [path] = splitHref(href);
    if (isExternal(href) || !path || kept.has(path)) continue;
    a.removeAttribute('href');
    changed = true;
  }
  return changed ? serializeChildren(body) : html;
}
