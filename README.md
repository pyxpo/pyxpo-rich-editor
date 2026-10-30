# pyxpo-rich-editor

[![CI](https://github.com/pyxpo/pyxpo-rich-editor/actions/workflows/ci.yml/badge.svg)](https://github.com/pyxpo/pyxpo-rich-editor/actions/workflows/ci.yml) [![PyPI](https://img.shields.io/pypi/v/pyxpo-rich-editor)](https://pypi.org/project/pyxpo-rich-editor/) [![Python](https://img.shields.io/pypi/pyversions/pyxpo-rich-editor)](https://pypi.org/project/pyxpo-rich-editor/) [![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

A full rich text editor for [pyxpo](https://github.com/pyxpo/pyxpo) apps, written in Python. It edits HTML the way a
word processor does. Use it for blog posts, notes, emails and product descriptions. Its toolbar has headings,
lists, links, colours, tables, images, video embeds, find and replace, and more. It works on Android, iOS, the Mac,
the web and the desktop window, and it needs no network.

<p align="center">
  <img src="https://raw.githubusercontent.com/pyxpo/pyxpo-rich-editor/main/docs/images/hero.png" width="820" alt="The rich editor on iOS and Android, in light and dark mode">
</p>

```python
import pyxpo_rich_editor as Rich
from pyxpo import component, use_state


@component
def PostBody():
    body, set_body = use_state("<p>Hello</p>")
    return Rich.RichEditor(value=body, on_change=set_body, placeholder="Start writing...", style={"flex": 1})
```

## Features

- **A real editor, not a text field:**
  - paragraph and heading styles (H1 to H4), bold, italic, underline, strike, inline code, sub- and superscript
  - text colour and highlight, font, size, line height and letter case
  - links, bullet and numbered lists, quotes, alignment, indent and outdent
  - undo and redo, clear formatting, find and replace
- **An insert menu:**
  - images by address or from the app (photo library, camera, your upload)
  - tables with row, column, header and merge tools
  - YouTube and Vimeo embeds, buttons, dividers, code blocks
  - two and three columns, product cards and recipe cards
- **Tools in place:** select an image to resize and align it; select a table to edit its rows and columns.
- **Clean paste:** text pasted from Word, Google Docs or a web page keeps its headings, lists, links and alignment.
  The editor removes the fonts, sizes and colours those apps add to every line.
- **Nothing is lost:** markup the editor has no block for is kept as it was and saved back unchanged.
- **One format out:** `on_change` always gives HTML. Old Markdown or plain text opens as the formatting it means.
- **Fits your app:** your colours, dark mode, every label translated, and your own footer.
- **Works offline:** Tiptap, the icons and the styles ship inside the wheel. Fonts are the system fonts.

## Contents

| If you are... | Start here |
| --- | --- |
| New to the package | [Install](#install) → [Quick start](#quick-start) |
| Loading posts you already have | [Values and formats](#values-and-formats) |
| Adding photos | [Images from the app](#images-from-the-app) |
| Driving the editor from Python | [The editor handle](#the-editor-handle) |
| Matching your design or language | [Theme and dark mode](#theme-and-dark-mode) · [Translations](#translations) |
| Seeing it in a real app | [Recipe: a post editor that saves drafts](#recipe-a-post-editor-that-saves-drafts) |
| Looking for exact signatures | [API reference](#api-reference) |
| Stuck | [Testing](#testing) · [Troubleshooting](#troubleshooting) · [FAQ](#faq) |

## Platform support

| Target | Editor |
| --- | --- |
| Android, API 24+ | `android.webkit.WebView`, with the system keyboard. |
| iOS 13+ and Mac Catalyst | `WKWebView`. The keyboard opens when the user taps the page or when you call `focus()`. |
| Web page (`pyxpo run web`) | An `<iframe>` in the page. |
| Desktop window (`pyxpo run desktop`) | An `<iframe>` in the window's web view. |

Requires Python 3.9+ and `pyxpo>=0.1.0a3`.

## Install

```sh
pip install pyxpo-rich-editor
```

Add the module to your app's `pyproject.toml`:

```toml
[project]
dependencies = ["pyxpo", "pyxpo-rich-editor"]

[tool.pyxpo]
modules = ["rich-editor"]
```

The module has native code, so rebuild the app after you add it (`pyxpo run android` or `pyxpo run ios`). It adds
no SDK and no permission.

## Quick start

`RichEditor` is a component. Give it the document in `value` and keep what `on_change` sends back, as you would
with a `TextInput`:

```python
import pyxpo_rich_editor as Rich
from pyxpo import Text, View, component, use_state


@component
def Note():
    body, set_body = use_state("<h2>Shopping</h2><ul><li>Milk</li><li>Bread</li></ul>")
    count, set_count = use_state("")

    return View(
        Rich.RichEditor(
            value=body,
            on_change=set_body,                                    # HTML, after every change
            on_state=lambda s: set_count("%d words" % s["words"]),
            placeholder="Write something...",
            style={"flex": 1},                                     # the editor fills the space it gets
        ),
        Text(count),
        style={"flex": 1},
    )
```

The editor needs a size. Give it `flex: 1` in a column, or a fixed `height`. Its toolbar stays on top and the
page scrolls under it.

Passing back the HTML that `on_change` gave you never moves the cursor or resets undo. A different value, such as
a post you load from the server, replaces the document.

## Values and formats

`on_change` always gives HTML. `value` can be HTML, Markdown or plain text, set by `value_format`:

```python
Rich.RichEditor(value=post["body"], value_format=post["format"], on_change=save_html)
```

| `value_format` | What the editor shows |
| --- | --- |
| `"html"` (default) | The HTML as it is. Markup with no block in the editor, such as a `<form>` or an embed from another site, is kept and shown as a locked block. |
| `"markdown"` | The formatting the Markdown means: headings, lists, links, code, quotes and tables. |
| `"plain"` | One paragraph for each line. |

A Markdown or plain value comes straight back through `on_change` as HTML. Store that HTML, and store the format
as `"html"` from then on.

## The toolbar

<p align="center">
  <img src="https://raw.githubusercontent.com/pyxpo/pyxpo-rich-editor/main/docs/images/toolbar.png" width="820" alt="The text style menu, the insert menu and the image tools">
</p>

The toolbar scrolls sideways on a phone. From left to right:

| Group | Tools |
| --- | --- |
| History | Undo, redo |
| Block | Text style menu: text, Heading 1 to 4 |
| Marks | Bold, italic, underline, strikethrough, inline code, subscript, superscript |
| Colour | Text colour, highlight |
| Links | Add, edit and remove a link |
| Lists and blocks | Bullet list, numbered list, quote |
| Layout | Alignment (left, centre, right, justify), indent, outdent |
| Type | Font, size, line height, letter case, clear formatting |
| Insert | Image, table, video, button, divider, code block, two and three columns, product card, recipe card |
| Find | Find and replace, with match count and next and previous |

Selecting an image shows its tools: left, centre, right, a description for screen readers, and delete. Drag a
corner to resize it. Selecting a table shows row, column, header row, merge and split, and delete.

The footer under the page shows the word and character count. Set `footer` to show your own text, or `""` to
hide it.

## Images from the app

Without `on_pick_image`, the image sheet asks for an image address. With it, the sheet also has a **Choose photo**
button. The editor calls your function and inserts what it returns:

```python
import pyxpo_rich_editor as Rich
from pyxpo_image_picker import ImagePicker


async def pick_and_upload():
    result = await ImagePicker.launchImageLibraryAsync(mediaTypes="images")
    if result.get("canceled"):
        return None                                   # the user cancelled: nothing is inserted
    url = await my_api.upload(result["assets"][0])    # your server, your storage
    return {"src": url, "alt": ""}                    # or just the URL as a string


Rich.RichEditor(value=body, on_change=set_body, on_pick_image=pick_and_upload)
```

- The function can be sync or async. Return a URL, a `{"src", "alt"}` dict, or `None` for no image.
- While it runs, the footer shows **Uploading…** and the user can keep typing. The picture goes in where the
  cursor was when the user chose it.
- If it raises, the footer shows the exception's message for a moment. The document stays as it was, and the
  error also goes to pyxpo's error report.
- `src` can be an `http(s)` URL or a `data:` URL. Upload large photos: a `data:` URL makes the HTML as large as the
  picture.

## The editor handle

Pass a `ref` to drive the editor from Python. `ref.current` is a `RichEditorHandle`:

```python
from pyxpo import Pressable, Text, View, component, use_ref, use_state


@component
def Composer():
    body, set_body = use_state("")
    editor = use_ref(None)

    return View(
        Pressable(Text("Add signature"),
                  on_press=lambda: editor.current.insert_html("<p>— Sent from my phone</p>")),
        Pressable(Text("Bold"), on_press=lambda: editor.current.exec("toggleBold")),
        Rich.RichEditor(ref=editor, value=body, on_change=set_body, style={"flex": 1}),
        style={"flex": 1},
    )
```

| Method | What it does |
| --- | --- |
| `focus()` | Puts the cursor in the editor and opens the keyboard. |
| `blur()` | Takes the cursor out and closes the keyboard. |
| `insert_html(html)` | Inserts HTML at the cursor, replacing the selection. |
| `insert_image(src, alt=None)` | Inserts a picture at the cursor. |
| `exec(name, *args)` | Runs a [Tiptap command](https://tiptap.dev/docs/editor/api/commands) on the selection: `exec("toggleBold")`, `exec("setTextAlign", "center")`, `exec("toggleHeading", {"level": 2})`. A name with no command does nothing. |

The handle needs a mounted editor. Calling it before the first render raises `RuntimeError("the RichEditor is not
mounted")`.

## Theme and dark mode

The editor uses neutral colours by default. Pass your app's palette in `colors` and set `dark` in dark mode:

```python
from pyxpo import use_color_scheme

DARK = {"panel": "#16161a", "sunken": "#0f0f12", "line": "#2a2a31", "ink": "#f4f4f5", "fg2": "#d4d4d8",
        "muted": "#a1a1aa", "faint": "#71717a", "accent": "#e11d48", "accentInk": "#ffffff", "bad": "#f87171"}

dark = use_color_scheme() == "dark"
Rich.RichEditor(value=body, on_change=set_body, colors=DARK if dark else None, dark=dark)
```

| Colour | Used for |
| --- | --- |
| `panel` | The page and the toolbar |
| `sunken` | Code blocks, the footer, inputs in sheets |
| `line` | Borders and dividers |
| `ink` | Body text |
| `fg2` | Toolbar icons |
| `muted` | Captions and the footer |
| `faint` | The placeholder |
| `accent` | The cursor, the selection, links and active buttons |
| `accentInk` | Text on `accent` |
| `bad` | Error messages |

Each value is any CSS colour. Leave a name out to keep its default. `dark=True` also switches the scroll bars and
form controls inside the page to dark.

## Translations

`labels` replaces any text the editor shows. `Rich.LABELS` lists all of them in English, by key:

```python
Rich.RichEditor(value=body, on_change=set_body, labels={
    "placeholder": "Escribe aquí...",
    "bold": "Negrita",
    "count": "{words} palabras · {chars} caracteres",
})
```

`{words}` and `{chars}` in `count`, and `{i}` and `{n}` in `matchCount`, are filled in. Keys you leave out stay
in English.

## Recipe: a post editor that saves drafts

This is the body field in [CMSKite](https://cmskite.com)'s post editor, shortened. It loads a post in any format,
uploads photos to the site's media library, and follows the app's theme.

<p align="center">
  <img src="https://raw.githubusercontent.com/pyxpo/pyxpo-rich-editor/main/docs/images/cmskite.png" width="300" alt="CMSKite's post editor with the rich editor as the body field">
</p>

```python
import pyxpo_rich_editor as Rich
from pyxpo import Text, View, component, use_state


@component
def Body(*, form, change, project_id):
    theme = use_app_theme()
    focused, set_focused = use_state(False)

    async def pick():
        result = await ImagePicker.launchImageLibraryAsync(mediaTypes="images")
        if result.get("canceled"):
            return None
        media = await media_api.upload(project_id, result["assets"][0], form.slug)
        return {"src": media["url"], "alt": media.get("altText") or ""}

    return View(
        Text("Body"),
        Rich.RichEditor(
            value=form.body,
            value_format=form.body_format,                     # old posts may be Markdown
            on_change=lambda html: change(body=html, body_format="html"),
            on_pick_image=pick,
            on_focus=lambda: set_focused(True),
            on_blur=lambda: set_focused(False),
            colors=theme.editor_colors,
            dark=theme.dark,
            style={"height": 480, "borderWidth": 1, "borderRadius": 14,
                   "borderColor": theme.colors.ink if focused else theme.colors.line},
        ),
    )
```

## Testing

**Unit tests** run without a device. The editor is one native view, `PxRichEditorView`, and the page talks to
Python only through that view's `message` event. A test plays the page's part: find the view by its `test_id`
and send it a `message` event whose value is the JSON the page would send.

```python
import json

# `renderer` is your test renderer; the event name and payload are what the native view sends.
renderer.emit("message", renderer.node("post-body"), {"value": json.dumps({"type": "change", "html": "<p>Hello</p>"})})
assert saved_body() == "<p>Hello</p>"
```

The page sends these messages:

| Message | Calls |
| --- | --- |
| `{"type": "change", "html": ...}` | `on_change(html)` |
| `{"type": "state", "words", "chars", "canUndo", "canRedo"}` | `on_state(info)` |
| `{"type": "focus"}` / `{"type": "blur"}` | `on_focus()` / `on_blur()` |
| `{"type": "pickImage", "id": ...}` | `on_pick_image()`, then the result goes back to the page |

**On a phone or emulator,** the page can be inspected:

- iOS 16.4+: Safari > Develop > *your simulator or phone* > the editor page.
- Android: `chrome://inspect` in Chrome on the computer, in a debug build.

## Troubleshooting

| Problem | Cause and fix |
| --- | --- |
| `ModuleNotLinkedError` for `RichEditor` or the editor is an empty box on a phone | `rich-editor` is not in `[tool.pyxpo] modules`, or the app was not rebuilt after you added it. |
| The editor has no height | It needs a size: `flex: 1` inside a column that has a height, or a fixed `height`. |
| The cursor jumps to the start while typing | `value` was changed to something other than what `on_change` gave, for example HTML you reformatted. Store the HTML as it comes. |
| A loaded post does not show | `value` is set before the post arrives and never changes. Render the editor after the post loads, or pass the loaded body as `value`. |
| Markdown shows as plain text with `#` and `*` | Pass `value_format="markdown"`. |
| **Choose photo** is missing from the image sheet | Pass `on_pick_image`. |
| An image never appears after **Choose photo** | The function returned something other than a URL, a dict with `src`, or `None`. The error report names what it returned. |
| `ValueError: value_format must be one of html, markdown, plain` | Check the spelling of `value_format`. |

## FAQ

**Does it need the internet?** No. The page, its scripts and its icons are in the wheel. Images and video embeds
load from their own addresses, so they need the network to show.

**Can I get Markdown out?** Not from the editor. It edits HTML. Convert the HTML on your server if you need
Markdown.

**Is the HTML safe to show on a website?** It is the HTML the user wrote, and it can hold links and embeds. Clean
it on the server before you show it to other people, as you would any user content.

**Why a web view and not native text?** Neither platform has a native rich text control with lists, tables and
embeds that saves HTML. A web view gives the same editor and the same HTML on every platform.

**How large can a document be?** Posts of tens of thousands of words work. Each change sends the whole HTML to
Python, so keep `on_change` light: store the value, and save to the server on a timer or a button.

## API reference

```python
RichEditor(
    value: str = "",
    on_change: Callable[[str], Any] | None = None,
    value_format: str = "html",                  # "html", "markdown" or "plain"
    placeholder: str = "",
    editable: bool = True,
    labels: Mapping[str, str] | None = None,     # keys of LABELS
    colors: Mapping[str, str] | None = None,     # see Theme and dark mode
    dark: bool = False,
    footer: str | None = None,                   # None: word count; "": no footer
    on_focus: Callable[[], Any] | None = None,
    on_blur: Callable[[], Any] | None = None,
    on_state: Callable[[dict], Any] | None = None,
    on_pick_image: Callable[[], Any] | None = None,
    style=None,
    ref=None,                                    # ref.current is a RichEditorHandle
    test_id: str | None = None,
)
```

| Name | What it is |
| --- | --- |
| `RichEditor` | The editor component. |
| `RichEditorHandle` | `ref.current`: `focus()`, `blur()`, `exec(name, *args)`, `insert_html(html)`, `insert_image(src, alt=None)`. |
| `VALUE_FORMATS` | `("html", "markdown", "plain")` |
| `LABELS` | Every text the editor shows, in English, by key. |

`editable=False` hides the toolbar and makes the page read-only, which is a simple way to preview a post.

## License

MIT. The editor page bundles Tiptap, ProseMirror and marked (MIT) and Lucide icons (ISC). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
