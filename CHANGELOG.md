# Changelog

## Unreleased

- First release: `RichEditor`, a full rich text editor built on Tiptap 3 and shown in WKWebView on iOS and Mac
  Catalyst, `android.webkit.WebView` on Android and an `<iframe>` on the web page and the desktop window. The page is
  bundled into the package and needs no network.
- Toolbar: undo and redo, paragraph and heading styles, bold, italic, underline, strike, text colour and highlight,
  links, bullet and numbered lists, quotes, alignment, indent, inline code, sub- and superscript, font, size,
  line height, letter case, clear formatting, and find and replace.
- Insert menu: images by URL or from the app (`on_pick_image`), tables with row and column tools, video embeds,
  buttons, dividers, code blocks, columns, product and recipe cards. Images resize and align in place.
- `value_format` "markdown" and "plain" turn old content into HTML; `on_change` always gives HTML.
- `labels`, `colors`, `dark` and `footer` fit the editor to the app; `LABELS` lists every English text.
- `ref.current.focus()`, `.blur()`, `.exec(name, *args)`, `.insert_html(html)` and `.insert_image(src, alt)`.
