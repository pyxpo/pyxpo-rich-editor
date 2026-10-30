/**
 * What Word and Google Docs put on the clipboard besides the words.
 *
 * The editor's schema already drops markup it has no node for, but some of the
 * junk maps onto nodes it does have: Google Docs wraps the whole paste in a
 * bold tag, Word sends its list bullets as text and its blank lines as empty
 * paragraphs. Those would arrive as a bold post and stray dots. This removes
 * them before the schema sees the paste; alignment survives, since it is a
 * button on the toolbar.
 *
 * Text colour, highlight, font and size are toolbar buttons too, but a paste
 * from another app sets all four on every run of text (Docs: black, 11pt,
 * Arial), which would pin the post to that look. So inline styles go, unless
 * the paste came from this editor itself (ProseMirror marks its own clipboard
 * with `data-pm-slice`), where they are the writer's own choices.
 */
export function cleanPastedHtml(html: string): string {
  const own = html.includes("data-pm-slice");
  const cleaned = stripInvisible(html)
    // Word's conditional comments and the XML islands inside them.
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?(o|w|m|v):[^>]*>/gi, "")
    .replace(/<(style|xml|meta|link)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(meta|link)[^>]*\/?>/gi, "")
    // Google Docs: <b style="font-weight:normal" id="docs-internal-guid-…"> around everything.
    .replace(/<b[^>]*id="docs-internal-guid[^"]*"[^>]*>([\s\S]*)<\/b>/i, "$1")
    // Word's typed bullets ("·", "§", "1.") inside its fake list paragraphs.
    .replace(
      /<span[^>]*mso-list:\s*Ignore[^>]*>(?:[^<]|<span[^>]*>[^<]*<\/span>)*<\/span>/gi,
      "",
    )
    // Blank lines made of empty paragraphs.
    .replace(
      /<p[^>]*>(\s|&nbsp;|<br\s*\/?>|<span[^>]*>(\s|&nbsp;)*<\/span>)*<\/p>/gi,
      "",
    );
  if (own) return cleaned;
  // Foreign styles on inline runs only; a block's `text-align` stays.
  return cleaned.replace(
    /<(span|font|b|i|u|strong|em|a|mark)(\s[^>]*?)?\sstyle="[^"]*"/gi,
    "<$1$2",
  );
}

/**
 * Characters that show nothing but split words: zero-width space, word joiner, byte order mark and soft hyphen. AI
 * chat answers and some sites leave them in copied text, where they break search on the keyword ("run\u200Bning" is
 * not "running"). Zero-width joiners and bidi marks stay: emoji and right-to-left text need them.
 */
export function stripInvisible(text: string): string {
  return text.replace(/[\u200B\u2060\uFEFF\u00AD]/g, "");
}

// Tags that say a paste is a page's markup and not prose that merely starts with "<".
const MARKUP =
  /<\/?(p|h[1-6]|ul|ol|li|div|br|hr|strong|em|b|i|u|a|img|table|tr|td|th|blockquote|pre|code|span|section|article|figure|body|html)\b/i;

/**
 * HTML source copied as text -- from a code editor, a CMS's source view or a chat answer -- as the HTML to
 * paste, so it arrives formatted rather than as tags; null for anything else.
 *
 * `html` is the clipboard's rich copy, if any. A web page sends one with the formatting already in it, and
 * that one wins. A code editor sends its syntax colouring, where the tags show as escaped text (`&lt;h1&gt;`):
 * the plain copy is the markup then. Only a <body>'s contents are kept from a whole document, so its head
 * (the <title>, scripts, styles) does not land in the post as text.
 */
export function htmlSource(text: string, html = ""): string | null {
  const source = text.trim();
  if (!/^<(!doctype\s|[a-z][a-z0-9-]*[\s>/])/i.test(source)) return null;
  if (!source.endsWith(">") || !MARKUP.test(source)) return null;
  if (html && !html.includes("&lt;")) return null;
  const body = source.match(/<body[^>]*>([\s\S]*?)(<\/body>|$)/i);
  return (body ? body[1]! : source)
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<!doctype[^>]*>/i, "");
}
