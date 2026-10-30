"""pyxpo-rich-editor: props on the wire, page messages, the handle over a fake bridge, image picking and web.js."""
import asyncio
import json
import shutil
import subprocess

import pytest

from pyxpo import LocalChannel, component, create_app, use_ref
from pyxpo.app import App
from pyxpo.build import web
from pyxpo.module_testing import FakeBridge
from pyxpo.renderers.mock import MockRenderer
from pyxpo.renderers.web import page_js

import pyxpo_rich_editor as R


def mount(root):
    ch = LocalChannel()
    r = MockRenderer(ch)
    app = create_app(root, ch)
    return app, r


def say(r, node, **message):
    r.emit("message", node, {"value": json.dumps(message)})


def test_props_on_the_wire():
    @component
    def Root():
        return R.RichEditor(value="# Hi", value_format="markdown", placeholder="Write", editable=False,
                            labels={"bold": "Negrita"}, colors={"accent": "#f00"}, dark=True, footer="",
                            style={"flex": 1})

    app, r = mount(Root)
    (node,) = r.find_all("PxRichEditorView")
    p = node.props
    assert p["document"] == R._DOCUMENT and p["document"].startswith("<!doctype html>")
    assert json.loads(p["value"]) == {"html": "# Hi", "format": "markdown"}
    assert json.loads(p["config"]) == {"placeholder": "Write", "editable": False, "labels": {"bold": "Negrita"},
                                       "colors": {"accent": "#f00"}, "dark": True, "canPickImage": False,
                                       "footer": ""}
    assert p["on_message"] is True


def test_defaults_and_labels():
    @component
    def Root():
        return R.RichEditor()

    app, r = mount(Root)
    p = r.find_all("PxRichEditorView")[0].props
    assert json.loads(p["value"]) == {"html": "", "format": "html"}
    assert "footer" not in json.loads(p["config"])
    assert R.LABELS["bold"] and len(R.LABELS) > 100 and "{words}" in R.LABELS["count"]


def test_bad_value_format():
    @component
    def Root():
        return R.RichEditor(value_format="rtf")

    app = App(Root, LocalChannel(), None)
    app.on_error = lambda e: (_ for _ in ()).throw(e)
    with pytest.raises(ValueError):
        app.start()


def test_page_messages_reach_the_callbacks():
    got = []

    @component
    def Root():
        return R.RichEditor(on_change=lambda h: got.append(("change", h)), on_state=lambda s: got.append(s),
                            on_focus=lambda: got.append("focus"), on_blur=lambda: got.append("blur"))

    app, r = mount(Root)
    node = r.find_all("PxRichEditorView")[0]
    say(r, node, type="ready")
    say(r, node, type="change", html="<p>a</p>")
    say(r, node, type="state", words=1, chars=1, canUndo=True, canRedo=False, extra=1)
    say(r, node, type="focus")
    say(r, node, type="blur")
    say(r, node, type="pickImage", id="1")  # no on_pick_image: ignored
    r.emit("message", node, {"value": "not json"})
    assert got == [("change", "<p>a</p>"), {"words": 1, "chars": 1, "canUndo": True, "canRedo": False},
                   "focus", "blur"]


def _handle(**props):
    refs = []

    @component
    def Root():
        ref = use_ref(None)
        refs.append(ref)
        return R.RichEditor(ref=ref, **props)

    app, r = mount(Root)
    return refs[-1], r, r.find_all("PxRichEditorView")[0]


def test_handle_posts_commands():
    ref, r, node = _handle()
    with FakeBridge("ios"):
        with pytest.raises(Exception, match="pyxpo-rich-editor"):
            ref.current.focus()
    with FakeBridge("android") as fb:
        fb.on("RichEditor", "post", lambda *a: None)
        h = ref.current
        assert isinstance(h, R.RichEditorHandle)
        h.focus()
        h.blur()
        h.exec("setTextAlign", "center")
        h.insert_html("<p>x</p>")
        h.insert_image("https://x.test/a.png", "A")
        sent = [(c[0], c[1], c[2][0], json.loads(c[2][1])) for c in fb.calls[-5:]]
        assert all(s[:3] == ("RichEditor", "post", node.id) for s in sent)
        assert [s[3] for s in sent] == [
            {"type": "focus"}, {"type": "blur"}, {"type": "exec", "name": "setTextAlign", "args": ["center"]},
            {"type": "exec", "name": "insertContent", "args": ["<p>x</p>"]},
            {"type": "image", "src": "https://x.test/a.png", "alt": "A"}]
        for bad in ("", "a.b", "run()", 3):
            with pytest.raises(ValueError):
                h.exec(bad)


@pytest.mark.parametrize("result,reply", [
    ("https://x.test/p.jpg", {"src": "https://x.test/p.jpg"}),
    ({"src": "data:image/png;base64,AA", "alt": "Cat"}, {"src": "data:image/png;base64,AA", "alt": "Cat"}),
    (None, {}),
])
def test_pick_image_replies(result, reply):
    async def pick():
        await asyncio.sleep(0)
        return result

    async def main():
        ref, r, node = _handle(on_pick_image=pick)
        assert json.loads(node.props["config"])["canPickImage"] is True
        with FakeBridge("android") as fb:
            fb.on("RichEditor", "post", lambda *a: None)
            say(r, node, type="pickImage", id="7")
            for _ in range(5):
                await asyncio.sleep(0)
            return [json.loads(c[2][1]) for c in fb.calls if c[1] == "post"]

    assert asyncio.run(main()) == [{"type": "image", "id": "7", **reply}]


def test_pick_image_error_is_shown():
    def pick():
        raise RuntimeError("no access to photos")

    async def main():
        ref, r, node = _handle(on_pick_image=pick)
        with FakeBridge("android") as fb:
            fb.on("RichEditor", "post", lambda *a: None)
            say(r, node, type="pickImage", id="2")
            for _ in range(5):
                await asyncio.sleep(0)
            return [json.loads(c[2][1]) for c in fb.calls if c[1] == "post"]

    assert asyncio.run(main()) == [{"type": "image", "id": "2", "error": "no access to photos"}]


def test_picked_rejects_other_values():
    with pytest.raises(TypeError):
        R._picked(3)
    with pytest.raises(TypeError):
        R._picked({"alt": "x"})


def test_page_js_and_web_build(tmp_path):
    assert set(page_js({"RichEditor": "pyxpo_rich_editor"})) == {"RichEditor"}
    p = tmp_path / "proj"
    (p / "app").mkdir(parents=True)
    (p / "app" / "index.py").write_text("print('hi')\n")
    (p / "pyproject.toml").write_text('[project]\nname="x"\nversion="1.0.0"\n[tool.pyxpo]\nname = "Demo"\n'
                                      'bundle_id = "com.acme.demo"\nmodules = ["rich-editor"]\n')
    out = web.build(p)
    html = (out / "index.html").read_text(encoding="utf-8")
    cfg = json.loads(html.split("window.PYXPO_CONFIG = ", 1)[1].split(";</script>", 1)[0])
    assert cfg["scripts"] == ["modules/RichEditor.js"]
    assert (out / "modules" / "RichEditor.js").read_text() == open(R.__path__[0] + "/web.js").read()


NODE_VIEW = r"""
const fs = require("fs");
let view, mod, listener;
const posted = [];
const frame = { style: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, remove() { this.removed = true; },
  contentWindow: { postMessage(m) { posted.push(m.__pxRichIn); } } };
global.document = { createElement: () => frame };
global.window = { addEventListener(n, f) { listener = f; }, removeEventListener() { listener = null; } };
global.pyxpoPage = { defineView(t, f) { view = f; }, defineModule(n, f) { mod = f; } };
eval(fs.readFileSync(process.argv[2], "utf8"));
const events = [];
const host = { style: {}, appendChild(c) { this.child = c; } };
const v = view(host, (n, d) => events.push([n, d]));
v.update({ document: "<p>page</p>", value: "V1", config: "C1" });
v.update({ value: "V2" });
mod("post", [5, '{"type":"focus"}'], { view: () => v });
const before = posted.length;
listener({ source: {}, data: { __pxRich: '{"type":"ready"}' } });  // another window: ignored
listener({ source: frame.contentWindow, data: { __pxRich: '{"type":"ready"}' } });
listener({ source: frame.contentWindow, data: { __pxRich: '{"type":"change","html":"<p>x</p>"}' } });
v.update({ value: "V3" });
v.update({ document: "<p>page 2</p>" });
v.update({ config: "C2" });
const reload = posted.length;
listener({ source: frame.contentWindow, data: { __pxRich: '{"type":"ready"}' } });
let missing = null;
try { mod("post", [9, "{}"], { view: () => null }); } catch (e) { missing = e.message; }
v.dispose();
console.log(JSON.stringify({ before, reload, posted, events, srcdoc: frame.srcdoc, removed: frame.removed,
  listener: listener, missing, appended: host.child === frame }));
"""


@pytest.mark.skipif(not shutil.which("node"), reason="needs node")
def test_web_js_queues_until_ready(tmp_path):
    subprocess.run(["node", "--check", R.__path__[0] + "/web.js"], check=True)
    (tmp_path / "t.js").write_text(NODE_VIEW)
    out = subprocess.run(["node", str(tmp_path / "t.js"), R.__path__[0] + "/web.js"], check=True,
                         capture_output=True, text=True).stdout
    got = json.loads(out)
    assert got["before"] == 0 and got["reload"] == 4 and got["appended"]
    assert got["posted"] == [
        {"type": "config", "data": "C1"}, {"type": "value", "data": "V2"}, {"type": "post", "data": '{"type":"focus"}'},
        {"type": "value", "data": "V3"},
        {"type": "value", "data": "V3"}, {"type": "config", "data": "C2"}]
    assert got["events"] == [["message", '{"type":"ready"}'], ["message", '{"type":"change","html":"<p>x</p>"}'],
                             ["message", '{"type":"ready"}']]
    assert got["srcdoc"] == "<p>page 2</p>" and got["removed"] and got["listener"] is None
    assert got["missing"] == "The RichEditor is not mounted"
