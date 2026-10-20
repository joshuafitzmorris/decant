/**
 * Ebooks style text with classes ("<span class="calibre7">") and stylesheets that
 * most targets can't use: MOBI has no CSS, FB2 and PDF only know italic and bold.
 * This folds the parts that change meaning into plain markup, using the
 * document's own selector engine to find what each rule applies to.
 */

const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'cite',
  'code',
  'em',
  'font',
  'i',
  'kbd',
  'mark',
  'q',
  's',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'u',
  'var',
]);
const ALIGNABLE = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'figure', 'figcaption']);

interface Effects {
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  strike?: boolean;
  sup?: boolean;
  sub?: boolean;
  hidden?: boolean;
  align?: string;
}

/** Applies stylesheets and inline styles to a chapter document, then removes `class` and `style` attributes. */
export function flattenStyles(doc: Document, stylesheets: string[]): void {
  const body = doc.body ?? doc.documentElement;
  const effects = new Map<Element, Effects>();
  const merge = (element: Element, next: Effects) => {
    effects.set(element, { ...effects.get(element), ...next });
  };

  for (const css of stylesheets) {
    for (const { selectors, declarations } of parseRules(css)) {
      const result = effectsOf(declarations);
      if (!result) continue;
      for (const selector of selectors) {
        let matches: Element[];
        try {
          matches = Array.from(body.querySelectorAll(selector));
        } catch {
          continue; // Pseudo-classes and other selectors the parser rejects.
        }
        for (const element of matches) merge(element, result);
      }
    }
  }
  for (const element of Array.from(body.querySelectorAll('[style]'))) {
    const result = effectsOf(element.getAttribute('style') ?? '');
    if (result) merge(element, result);
  }

  for (const [element, effect] of effects) apply(doc, element, effect);
  for (const element of Array.from(body.querySelectorAll('[class], [style]'))) {
    element.removeAttribute('class');
    element.removeAttribute('style');
  }
}

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

function apply(doc: Document, element: Element, effect: Effects) {
  if (effect.hidden) {
    element.remove();
    return;
  }
  if (effect.align && ALIGNABLE.has(element.localName) && !element.hasAttribute('align'))
    element.setAttribute('align', effect.align);
  wrapContents(doc, element, effect);
}

/** Wraps an element's contents in <em>, <strong>..., innermost first, so <p class="epigraph"> stays a paragraph. */
function wrapContents(doc: Document, element: Element, effect: Effects) {
  const tag = element.localName;
  const wrappers = [
    effect.sub && 'sub',
    effect.sup && 'sup',
    effect.strike && 's',
    effect.underline && 'u',
    effect.bold && !/^(b|strong|h[1-6]|th)$/.test(tag) && 'strong',
    effect.italic && !/^(i|em|cite)$/.test(tag) && 'em',
  ].filter(Boolean) as string[];
  if (!wrappers.length || !element.hasChildNodes()) return;
  // Inline markup can't hold blocks: a styled <div> passes the style on to the paragraphs inside it.
  const blocks = Array.from(element.children).filter((child) => BLOCK_TAGS.has(child.localName));
  if (blocks.length) {
    for (const child of blocks) wrapContents(doc, child, effect);
    return;
  }
  if (!INLINE_TAGS.has(tag) && !BLOCK_TAGS.has(tag)) return;
  for (const name of wrappers) {
    const wrapper = doc.createElementNS(element.namespaceURI, name);
    while (element.firstChild) wrapper.append(element.firstChild);
    element.append(wrapper);
  }
}

function effectsOf(declarations: string): Effects | null {
  const effect: Effects = {};
  let any = false;
  for (const declaration of declarations.split(';')) {
    const colon = declaration.indexOf(':');
    if (colon < 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const value = declaration
      .slice(colon + 1)
      .replace(/!important/i, '')
      .trim()
      .toLowerCase();
    if (property === 'font-style' && /italic|oblique/.test(value)) effect.italic = any = true;
    else if (property === 'font-weight' && (/bold/.test(value) || Number(value) >= 600)) effect.bold = any = true;
    else if (property === 'text-decoration' || property === 'text-decoration-line') {
      if (value.includes('underline')) effect.underline = any = true;
      if (value.includes('line-through')) effect.strike = any = true;
    } else if (property === 'vertical-align' && (value === 'super' || value === 'sub')) {
      if (value === 'super') effect.sup = true;
      else effect.sub = true;
      any = true;
    } else if (property === 'text-align' && /^(center|right|justify)$/.test(value)) {
      effect.align = value;
      any = true;
    } else if (property === 'display' && value === 'none') effect.hidden = any = true;
  }
  return any ? effect : null;
}

/** A forgiving parser for the flat rules ebook stylesheets use; @-rules with their own blocks are skipped. */
export function parseRules(css: string): { selectors: string[]; declarations: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selectors: string[]; declarations: string }[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const prelude = text.slice(i, open).trim();
    // Find the matching close brace, so nested blocks (@media) are skipped whole.
    let depth = 1;
    let j = open + 1;
    for (; j < text.length && depth > 0; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
    }
    const body = text.slice(open + 1, j - 1);
    i = j;
    // Statements like @import end with ";" before the next rule.
    const selectorText = prelude.slice(prelude.lastIndexOf(';') + 1).trim();
    if (!selectorText || selectorText.startsWith('@') || body.includes('{')) continue;
    rules.push({
      selectors: selectorText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      declarations: body,
    });
  }
  return rules;
}
