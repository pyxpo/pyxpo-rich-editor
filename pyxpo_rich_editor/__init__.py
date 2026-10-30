"""A full rich text editor for pyxpo apps: the HTML a post or a note is written in, edited the way a word
processor edits it.

    import pyxpo_rich_editor as Rich
    from pyxpo import use_ref, use_state

    body, set_body = use_state("<p>Hello</p>")
    editor = use_ref(None)

    Rich.RichEditor(ref=editor, value=body, on_change=set_body, placeholder="Start writing...",
                    style={"flex": 1})

    editor.current.focus()
    editor.current.exec("toggleBold")

The editor is a Tiptap (ProseMirror) page bundled into the package and shown in the platform web view:
WKWebView on iOS and the Mac, `android.webkit.WebView` on Android, an `<iframe>` on the web and in the desktop
window. It needs no network: the page, its scripts and icons all ship inside the wheel; fonts are the system ones.

The toolbar has undo and redo, paragraph and heading styles, bold, italic, underline, strike, text colour and
highlight, links, lists, quotes, alignment and indent, inline code, sub- and superscript, font, size, line
height and letter case, find and replace, and an insert menu with images (by address, or from the app through
`on_pick_image`), tables, video embeds, buttons, dividers, code blocks, columns, product and recipe cards.
Selecting an image or a table shows the tools for it; markup the editor has no block for is kept as it was.
"""
from __future__ import annotations

import inspect
import json
from typing import Any, Callable, Dict, Mapping, Optional

from pyxpo import component, use_imperative_handle, use_ref
from pyxpo.module_api import call, native_view, report, require_linked, view_tag

from ._bundle import HTML as _DOCUMENT, LABELS as _LABELS

__version__ = "0.1.0a1"

__all__ = ["RichEditor", "RichEditorHandle", "VALUE_FORMATS", "LABELS"]

_View = native_view("PxRichEditorView")

VALUE_FORMATS = ("html", "markdown", "plain")

#: Every text the editor shows, by key, in English. Pass any of them in `labels` to translate the editor.
#: `{words}` and `{chars}` in "count" are filled in, and so are `{i}` and `{n}` in "matchCount".
LABELS: Dict[str, str] = dict(_LABELS)


def _post(view_ref: Any, message: Dict[str, Any]) -> None:
    require_linked("RichEditor", "rich-editor", package="pyxpo-rich-editor")
    tag = view_tag(view_ref)
    if tag is None:
        raise RuntimeError("the RichEditor is not mounted")
    call("RichEditor", "post", tag, json.dumps(message))


class RichEditorHandle:
    """`ref.current` of a mounted `RichEditor`."""

    def __init__(self, view_ref: Any) -> None:
        self._view = view_ref

    def focus(self) -> None:
        """Puts the cursor in the editor and shows the keyboard."""
        _post(self._view, {"type": "focus"})

    def blur(self) -> None:
        """Takes the cursor out of the editor and hides the keyboard."""
        _post(self._view, {"type": "blur"})

    def exec(self, name: str, *args: Any) -> None:
        """Runs a Tiptap command on the selection, as `editor.chain().focus().<name>(*args).run()` would:
        `exec("toggleBold")`, `exec("setTextAlign", "center")`, `exec("insertContent", "<p>Hi</p>")`.
        A name the editor has no command for does nothing."""
        if not isinstance(name, str) or not name.isidentifier():
            raise ValueError("name must be a command name, got %r" % (name,))
        _post(self._view, {"type": "exec", "name": name, "args": list(args)})

    def insert_html(self, html: str) -> None:
        """Inserts `html` at the cursor, replacing the selection."""
        self.exec("insertContent", str(html))

    def insert_image(self, src: str, alt: Optional[str] = None) -> None:
        """Inserts a picture at the cursor. `src` is an http(s) or data: URL."""
        _post(self._view, {"type": "image", "src": str(src), "alt": alt or ""})


def _picked(value: Any) -> Dict[str, Any]:
    """What `on_pick_image` returned, as the reply the page expects."""
    if value is None:
        return {}
    if isinstance(value, str):
        return {"src": value}
    if isinstance(value, Mapping) and isinstance(value.get("src"), str):
        return {"src": value["src"], "alt": str(value.get("alt") or "")}
    raise TypeError("on_pick_image must return a URL, a {'src', 'alt'} dict or None, got %r" % (value,))


@component
def RichEditor(value: str = "", on_change: Optional[Callable[[str], Any]] = None, value_format: str = "html",
               placeholder: str = "", editable: bool = True, labels: Optional[Mapping[str, str]] = None,
               colors: Optional[Mapping[str, str]] = None, dark: bool = False, footer: Optional[str] = None,
               on_focus: Optional[Callable[[], Any]] = None, on_blur: Optional[Callable[[], Any]] = None,
               on_state: Optional[Callable[[Dict[str, Any]], Any]] = None,
               on_pick_image: Optional[Callable[[], Any]] = None, style: Any = None, **props: Any):
    """A rich text editor sized by `style`, with its toolbar on top. `ref.current` is a `RichEditorHandle`.

    `value` is the document. The editor always hands back HTML through `on_change(html)`; a `value` in
    `value_format` "markdown" or "plain" is shown as the formatting it means and comes straight back as HTML.
    Passing back what `on_change` gave you never moves the cursor.

    `labels` translates the editor (keys of `LABELS`); `colors` sets its palette as CSS colours by name
    ("panel", "sunken", "line", "ink", "fg2", "muted", "faint", "accent", "accentInk", "bad"); `dark` switches
    form controls and scroll bars to dark. `footer` replaces the word count under the page; "" hides it.

    `on_state(info)` gets `{"words", "chars", "canUndo", "canRedo"}` after every change. `on_pick_image()` adds
    "Choose photo" to the image sheet: return (or await to) a URL, a `{"src", "alt"}` dict, or None when the
    user cancelled. An exception shows its message in the editor and leaves the document as it was."""
    if value_format not in VALUE_FORMATS:
        raise ValueError("value_format must be one of %s, got %r" % (", ".join(VALUE_FORMATS), value_format))
    ref = props.pop("ref", None)
    inner = use_ref(None)
    use_imperative_handle(ref, lambda: RichEditorHandle(inner), [])

    async def pick(image_id: str) -> None:
        try:
            result = on_pick_image()  # type: ignore[misc]
            if inspect.isawaitable(result):
                result = await result
            reply = _picked(result)
        except Exception as e:  # shown in the editor; the app still hears about it
            reply = {"error": str(e)}
            report(e)
        _post(inner, {"type": "image", "id": image_id, **reply})

    def on_message(raw: Any) -> Any:
        try:
            message = json.loads(raw) if isinstance(raw, str) else dict(raw or {})
        except (TypeError, ValueError):
            return None
        kind = message.get("type")
        if kind == "change" and on_change is not None:
            return on_change(str(message.get("html") or ""))
        if kind == "state" and on_state is not None:
            return on_state({k: message.get(k) for k in ("words", "chars", "canUndo", "canRedo")})
        if kind == "focus" and on_focus is not None:
            return on_focus()
        if kind == "blur" and on_blur is not None:
            return on_blur()
        if kind == "pickImage" and on_pick_image is not None:
            return pick(str(message.get("id") or ""))
        return None

    config: Dict[str, Any] = {
        "placeholder": str(placeholder or ""), "editable": bool(editable), "labels": dict(labels or {}),
        "colors": dict(colors or {}), "dark": bool(dark), "canPickImage": on_pick_image is not None,
    }
    if footer is not None:
        config["footer"] = str(footer)
    return _View(ref=inner, style=style, document=_DOCUMENT,
                 value=json.dumps({"html": str(value or ""), "format": value_format}),
                 config=json.dumps(config, sort_keys=True), on_message=on_message, **props)
