/**
 * The editor page that runs inside the native web view (WKWebView, Android WebView, or an iframe on the web).
 *
 * Everything the writer touches lives here: the toolbar, the row of tools for a table, picture or link, the
 * sheets for links, pictures and cards, find and replace, and the word count. The app around it only sends
 * the post's HTML, the settings and the theme, and hears back the HTML as it changes.
 *
 * Messages in:  { type: "value", data: '{"html": "...", "format": "html|markdown|plain"}' }
 *               { type: "config", data: '{"placeholder", "editable", "labels", "colors", "canPickImage", "footer"}' }
 *               { type: "post", data: '{"type": "focus|blur|exec|image", ...}' }
 * Messages out: ready, change {html}, state {words, chars, canUndo, canRedo}, focus, blur, pickImage {id}.
 */
import { Editor, type ChainedCommands } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CharacterCount, Placeholder } from "@tiptap/extensions";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { NodeSelection } from "@tiptap/pm/state";
import { marked } from "marked";
import ICONS from "virtual:icons";

import { BlockFormat, LINE_HEIGHTS } from "./block-format";
import { ContentBlocks, DEFAULT_RECIPE_LABELS, formatPrice, videoEmbedUrl } from "./content-blocks";
import { FindReplace, findKey } from "./find-replace";
import { linkHref } from "./link-href";
import { cleanPastedHtml, htmlSource, stripInvisible } from "./paste-cleanup";
import { RawBlock } from "./raw-block";
import { DEFAULT_LABELS } from "./labels";
import { ResizableImage, type ImageAlign } from "./resizable-image";
import { changeCase, TEXT_CASES, type TextCase } from "./text-case";
import css from "./editor.css";

// ---------------------------------------------------------------------------------------------------------
// Words on screen. The app sends its own, in the writer's language; these are what shows until it does.

type Labels = typeof DEFAULT_LABELS;
type LabelKey = keyof Labels;

let labels: Labels = { ...DEFAULT_LABELS };
const L = (key: LabelKey, values: Record<string, string | number> = {}) =>
  (labels[key] ?? DEFAULT_LABELS[key]).replace(/\{(\w+)\}/g, (all, name) => (name in values ? String(values[name]) : all));

interface Config {
  placeholder?: string;
  editable?: boolean;
  labels?: Partial<Labels>;
  colors?: Record<string, string>;
  dark?: boolean;
  canPickImage?: boolean;
  footer?: string | null;
}
let config: Config = { editable: true };

// Fonts every reader already has, so the published page looks as it did here without loading anything.
const FONTS: { name: string; value: string }[] = [
  { name: "Arial", value: "Arial, Helvetica, sans-serif" },
  { name: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { name: "Tahoma", value: "Tahoma, Geneva, sans-serif" },
  { name: "Trebuchet MS", value: "'Trebuchet MS', Helvetica, sans-serif" },
  { name: "System UI", value: "system-ui, sans-serif" },
  { name: "Georgia", value: "Georgia, serif" },
  { name: "Times New Roman", value: "'Times New Roman', Times, serif" },
  { name: "Garamond", value: "Garamond, Georgia, serif" },
  { name: "Courier New", value: "'Courier New', Courier, monospace" },
  { name: "Monospace", value: "ui-monospace, Menlo, monospace" },
];
const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];

// The grid people know from document editors: greys, then each hue from lightest to darkest.
const PALETTE = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
];

// ---------------------------------------------------------------------------------------------------------
// The bridge to the app.

type Out = { type: string; [key: string]: unknown };
interface Host {
  webkit?: { messageHandlers?: { px?: { postMessage(s: string): void } } };
  PxAndroid?: { post(s: string): void };
  px?: { receive(message: { type: string; data?: unknown }): void };
  pxLabels?: Labels;
}
const host = window as unknown as Host;

function send(message: Out) {
  const s = JSON.stringify(message);
  if (host.webkit?.messageHandlers?.px) host.webkit.messageHandlers.px.postMessage(s);
  else if (host.PxAndroid) host.PxAndroid.post(s);
  else if (window.parent !== window) window.parent.postMessage({ __pxRich: s }, "*");
}

// ---------------------------------------------------------------------------------------------------------
// Small DOM helpers.

type Kid = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...kids: (Kid | Kid[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = String(value);
    else if (key === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value as EventListener);
    else if (key === "html") el.innerHTML = String(value);
    else if (key in el && typeof value !== "string") (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

function icon(name: string): HTMLElement {
  return h("span", { class: "ic", "aria-hidden": "true", html: ICONS[name] ?? "" });
}

/** A press that leaves the writer's selection where it was: the editor never loses focus to a tool. */
function keepFocus(el: HTMLElement) {
  el.addEventListener("mousedown", (e) => e.preventDefault());
  return el;
}

// ---------------------------------------------------------------------------------------------------------
// The page.

document.head.append(h("style", {}, css));
const app = document.getElementById("app") ?? document.body.appendChild(h("div", { id: "app" }));
const bar = h("div", { class: "bar", role: "toolbar" });
const ctx = h("div", { class: "ctx", role: "toolbar", hidden: true });
const findbar = h("div", { class: "findbar", hidden: true });
const page = h("div", { class: "page" });
const scroller = h("div", { class: "scroll" }, page);
const footer = h("div", { class: "foot", "aria-live": "polite" });
const sheetLayer = h("div", { class: "layer", hidden: true });
app.append(bar, ctx, findbar, scroller, footer, sheetLayer);

const editor = new Editor({
  element: page,
  extensions: [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    Placeholder.configure({ placeholder: () => config.placeholder ?? L("placeholder") }),
    CharacterCount,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TextStyleKit.configure({ lineHeight: false }),
    Subscript,
    Superscript,
    BlockFormat,
    FindReplace,
    ResizableImage.configure({ inline: false }),
    TableKit.configure({ table: { resizable: true } }),
    ...ContentBlocks,
    RawBlock,
  ],
  content: "",
  editorProps: {
    attributes: {
      class: "rich-editor-content",
      spellcheck: "true",
      role: "textbox",
      "aria-multiline": "true",
    },
    transformPastedHTML: cleanPastedHtml,
    transformPastedText: stripInvisible,
    handlePaste: (view, event) => {
      const data = event.clipboardData;
      const text = data?.getData("text/plain") ?? "";
      // HTML source goes in as the formatting it describes, except in a code block, where the tags are the point.
      const source = view.state.selection.$from.parent.type.spec.code ? null : htmlSource(text, data?.getData("text/html"));
      if (source) return view.pasteHTML(source);
      return false;
    },
  },
});

// Tapping the empty page under the last line puts the cursor at the end, as a page of paper would. The focus
// moves inside the tap itself, not a frame later: typing straight away lands in the page, and the iOS
// keyboard only opens for a focus made during the tap.
scroller.addEventListener("mousedown", (e) => {
  if (e.target !== scroller && e.target !== page) return;
  e.preventDefault();
  editor.view.dom.focus({ preventScroll: true });
  editor.commands.focus("end");
});

const chain = (): ChainedCommands => editor.chain().focus();

// ---------------------------------------------------------------------------------------------------------
// Value in and out. The app hears every change; what it sends back is ignored when it is one of ours.

const recent: string[] = [];
const currentHtml = () => (editor.isEmpty ? "" : editor.getHTML());

function emitChange() {
  const html = currentHtml();
  recent.push(html);
  if (recent.length > 30) recent.shift();
  send({ type: "change", html });
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plainToHtml = (text: string) =>
  text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

// A value from the app is where the editing starts, not an edit: undo never walks back past it.
const load = (html: string) =>
  editor.chain().setMeta("addToHistory", false).setContent(html, { emitUpdate: false }).run();

function applyValue(value: { html?: string; format?: string }) {
  const body = value.html ?? "";
  const format = value.format ?? "html";
  if (format === "html") {
    if (body === currentHtml() || recent.includes(body)) return;
    load(body);
    return;
  }
  // A post written in Markdown or as plain text: shown as the formatting it means, and handed back as HTML.
  const html = format === "markdown" ? (marked.parse(body, { gfm: true, async: false }) as string) : plainToHtml(body);
  load(html);
  emitChange();
}

function applyConfig(next: Config) {
  config = { ...config, ...next };
  labels = { ...DEFAULT_LABELS, ...(config.labels ?? {}) };
  host.pxLabels = labels;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(config.colors ?? {})) root.style.setProperty(`--${name}`, value);
  root.style.colorScheme = config.dark ? "dark" : "light";
  editor.setEditable(config.editable !== false, false);
  editor.view.dom.setAttribute("aria-label", L("body"));
  // The placeholder is read when the view redraws its decorations: an empty transaction asks for one.
  editor.view.dispatch(editor.state.tr.setMeta("pxConfig", true));
  buildToolbar();
  refresh();
}

editor.on("update", emitChange);
editor.on("focus", () => send({ type: "focus" }));
editor.on("blur", () => send({ type: "blur" }));

// ---------------------------------------------------------------------------------------------------------
// The toolbar.

interface Tool {
  id: string;
  icon: string;
  label: LabelKey;
  run: () => void;
  active?: () => boolean;
  enabled?: () => boolean;
  /** The swatch under a colour tool, showing the colour the selection has now. */
  swatch?: () => string | null;
  text?: () => string;
}

const tools: Tool[][] = [
  [
    { id: "undo", icon: "undo-2", label: "undo", run: () => chain().undo().run(), enabled: () => editor.can().undo() },
    { id: "redo", icon: "redo-2", label: "redo", run: () => chain().redo().run(), enabled: () => editor.can().redo() },
  ],
  [
    {
      id: "block",
      icon: "chevron-down",
      label: "blockType",
      run: () => openBlockSheet(),
      text: () => BLOCKS.find((b) => b.active())?.name() ?? L("paragraph"),
    },
  ],
  [
    { id: "bold", icon: "bold", label: "bold", run: () => chain().toggleBold().run(), active: () => editor.isActive("bold") },
    { id: "italic", icon: "italic", label: "italic", run: () => chain().toggleItalic().run(), active: () => editor.isActive("italic") },
    {
      id: "underline",
      icon: "underline",
      label: "underline",
      run: () => chain().toggleUnderline().run(),
      active: () => editor.isActive("underline"),
    },
    { id: "strike", icon: "strikethrough", label: "strike", run: () => chain().toggleStrike().run(), active: () => editor.isActive("strike") },
  ],
  [
    {
      id: "color",
      icon: "baseline",
      label: "color",
      run: () => openColorSheet("color"),
      swatch: () => (editor.getAttributes("textStyle").color as string) || null,
    },
    {
      id: "highlight",
      icon: "highlighter",
      label: "highlight",
      run: () => openColorSheet("highlight"),
      swatch: () => (editor.getAttributes("textStyle").backgroundColor as string) || null,
    },
  ],
  [{ id: "link", icon: "link-2", label: "link", run: () => openLinkSheet(), active: () => editor.isActive("link") }],
  [
    { id: "bullets", icon: "list", label: "bullets", run: () => chain().toggleBulletList().run(), active: () => editor.isActive("bulletList") },
    {
      id: "numbered",
      icon: "list-ordered",
      label: "numbered",
      run: () => chain().toggleOrderedList().run(),
      active: () => editor.isActive("orderedList"),
    },
    { id: "quote", icon: "text-quote", label: "quote", run: () => chain().toggleBlockquote().run(), active: () => editor.isActive("blockquote") },
    { id: "align", icon: "text-align-start", label: "align", run: () => openAlignSheet() },
  ],
  [
    { id: "insert", icon: "plus", label: "insertMenu", run: () => openInsertSheet() },
    { id: "format", icon: "type", label: "format", run: () => openFormatSheet() },
    { id: "find", icon: "search", label: "find", run: () => toggleFind(), active: () => !findbar.hidden },
  ],
];

const ALIGN_ICONS: Record<string, string> = {
  left: "text-align-start",
  center: "text-align-center",
  right: "text-align-end",
  justify: "text-align-justify",
};
const currentAlign = () => (["center", "right", "justify"].find((a) => editor.isActive({ textAlign: a })) ?? "left") as string;

const buttons = new Map<string, { el: HTMLButtonElement; tool: Tool; swatch?: HTMLElement; text?: HTMLElement }>();

function buildToolbar() {
  bar.replaceChildren();
  buttons.clear();
  tools.forEach((group, i) => {
    if (i) bar.append(h("span", { class: "sep", "aria-hidden": "true" }));
    for (const tool of group) {
      const text = tool.text ? h("span", { class: "btn-text" }) : undefined;
      const swatch = tool.swatch ? h("span", { class: "swatch" }) : undefined;
      const el = keepFocus(
        h(
          "button",
          { type: "button", class: `btn btn-${tool.id}${text ? " btn-wide" : ""}`, title: L(tool.label), "aria-label": L(tool.label), onclick: tool.run },
          text,
          icon(tool.icon),
          swatch,
        ),
      ) as HTMLButtonElement;
      buttons.set(tool.id, { el, tool, swatch, text });
      bar.append(el);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------
// The row for what the cursor is in: a picture, a table or a link.

const selectedImage = () => {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === "image" ? selection.node : null;
};

function ctxButton(iconName: string | null, label: string, run: () => void, opts: { active?: boolean; danger?: boolean } = {}) {
  return keepFocus(
    h(
      "button",
      {
        type: "button",
        class: `chip${opts.active ? " is-active" : ""}${opts.danger ? " is-danger" : ""}`,
        title: label,
        "aria-label": label,
        "aria-pressed": opts.active ? "true" : undefined,
        onclick: run,
      },
      iconName ? icon(iconName) : null,
      iconName ? null : label,
    ),
  );
}

let ctxKey = "";
function renderContext() {
  if (!editor.isEditable) {
    ctx.hidden = true;
    return;
  }
  const image = selectedImage();
  const kids: HTMLElement[] = [];
  let key = "";
  if (image) {
    const align = (image.attrs.align as ImageAlign | null) ?? "left";
    const width = (image.attrs.width as string | null) ?? "";
    key = `image:${align}:${width}:${image.attrs.alt ?? ""}`;
    const setAttrs = (attrs: Record<string, unknown>) => chain().updateAttributes("image", attrs).run();
    kids.push(
      ctxButton("text-align-start", L("imageLeft"), () => setAttrs({ align: "left" }), { active: align === "left" }),
      ctxButton("text-align-center", L("imageCenter"), () => setAttrs({ align: "center" }), { active: align === "center" }),
      ctxButton("text-align-end", L("imageRight"), () => setAttrs({ align: "right" }), { active: align === "right" }),
      h("span", { class: "sep" }),
      ...["25%", "50%", "75%", "100%"].map((w) => ctxButton(null, w, () => setAttrs({ width: w }), { active: width === w })),
      h("span", { class: "sep" }),
      ctxButton("text-cursor-input", L("imageDescription"), () => openAltSheet()),
      ctxButton("trash-2", L("deleteImage"), () => chain().deleteSelection().run(), { danger: true }),
    );
  } else if (editor.isActive("table")) {
    key = `table:${editor.can().mergeOrSplit()}`;
    kids.push(
      ctxButton("between-vertical-start", L("rowAbove"), () => chain().addRowBefore().run()),
      ctxButton("between-vertical-end", L("rowBelow"), () => chain().addRowAfter().run()),
      ctxButton("list-x", L("deleteRow"), () => chain().deleteRow().run()),
      h("span", { class: "sep" }),
      ctxButton("between-horizontal-start", L("columnLeft"), () => chain().addColumnBefore().run()),
      ctxButton("between-horizontal-end", L("columnRight"), () => chain().addColumnAfter().run()),
      ctxButton("table-columns-split", L("deleteColumn"), () => chain().deleteColumn().run()),
      h("span", { class: "sep" }),
      ctxButton("panel-top", L("headerRow"), () => chain().toggleHeaderRow().run()),
      ctxButton("table-cells-merge", L("mergeCells"), () => chain().mergeOrSplit().run()),
      ctxButton("trash-2", L("deleteTable"), () => chain().deleteTable().run(), { danger: true }),
    );
  } else if (editor.isActive("link")) {
    const href = (editor.getAttributes("link").href as string) ?? "";
    key = `link:${href}`;
    kids.push(
      h("span", { class: "ctx-href", title: href }, icon("link-2"), h("span", {}, href)),
      ctxButton("pencil", L("editLink"), () => openLinkSheet()),
      ctxButton("unlink-2", L("removeLink"), () => chain().extendMarkRange("link").unsetLink().run()),
    );
  }
  if (key === ctxKey) return;
  ctxKey = key;
  ctx.replaceChildren(...kids);
  ctx.hidden = !kids.length;
}

// ---------------------------------------------------------------------------------------------------------
// Sheets: a panel that rises from the bottom of the editor, over a dimmed page.

let sheetOnClose: (() => void) | null = null;

function closeSheet() {
  sheetLayer.hidden = true;
  sheetLayer.replaceChildren();
  const after = sheetOnClose;
  sheetOnClose = null;
  after?.();
}

function openSheet(title: string, body: HTMLElement[], actions: HTMLElement[] = []) {
  const sheet = h(
    "div",
    { class: "sheet", role: "dialog", "aria-label": title },
    h(
      "div",
      { class: "sheet-head" },
      h("span", { class: "sheet-title" }, title),
      keepFocus(h("button", { type: "button", class: "btn", "aria-label": L("close"), onclick: closeSheet }, icon("x"))),
    ),
    h("div", { class: "sheet-body" }, ...body),
    actions.length ? h("div", { class: "sheet-actions" }, ...actions) : null,
  );
  sheetLayer.replaceChildren(h("div", { class: "scrim", onclick: closeSheet }), sheet);
  sheetLayer.hidden = false;
  return sheet;
}

function field(label: string, props: Record<string, unknown> = {}) {
  const input = h("input", { class: "input", type: "text", autocapitalize: "off", autocorrect: "off", spellcheck: "false", ...props });
  return { input, el: h("label", { class: "field" }, h("span", { class: "field-label" }, label), input) };
}

function area(label: string, props: Record<string, unknown> = {}) {
  const input = h("textarea", { class: "input", rows: 4, ...props });
  return { input, el: h("label", { class: "field" }, h("span", { class: "field-label" }, label), input) };
}

function primary(label: string, run: () => void) {
  return h("button", { type: "button", class: "action is-primary", onclick: run }, label);
}

function secondary(label: string, run: () => void, danger = false) {
  return h("button", { type: "button", class: `action${danger ? " is-danger" : ""}`, onclick: run }, label);
}

function problem() {
  return h("p", { class: "problem", hidden: true });
}

function show(el: HTMLElement, text: string) {
  el.textContent = text;
  el.hidden = !text;
}

/** Enter in a sheet's last box does what its main button does. */
function submitOnEnter(inputs: HTMLInputElement[], run: () => void) {
  for (const input of inputs) input.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), run()));
}

const BLOCKS = [
  { id: "paragraph", name: () => L("paragraph"), active: () => editor.isActive("paragraph") && !editor.isActive("blockquote"), run: () => chain().setParagraph().run() },
  { id: "h1", name: () => L("h1"), active: () => editor.isActive("heading", { level: 1 }), run: () => chain().toggleHeading({ level: 1 }).run() },
  { id: "h2", name: () => L("h2"), active: () => editor.isActive("heading", { level: 2 }), run: () => chain().toggleHeading({ level: 2 }).run() },
  { id: "h3", name: () => L("h3"), active: () => editor.isActive("heading", { level: 3 }), run: () => chain().toggleHeading({ level: 3 }).run() },
  { id: "h4", name: () => L("h4"), active: () => editor.isActive("heading", { level: 4 }), run: () => chain().toggleHeading({ level: 4 }).run() },
  { id: "quote", name: () => L("quote"), active: () => editor.isActive("blockquote"), run: () => chain().toggleBlockquote().run() },
  { id: "codeBlock", name: () => L("codeBlock"), active: () => editor.isActive("codeBlock"), run: () => chain().toggleCodeBlock().run() },
];

function openBlockSheet() {
  openSheet(L("blockType"), [
    h(
      "div",
      { class: "options" },
      BLOCKS.map((b) =>
        keepFocus(
          h(
            "button",
            { type: "button", class: `option option-${b.id}${b.active() ? " is-active" : ""}`, onclick: () => (closeSheet(), b.run()) },
            h("span", {}, b.name()),
            b.active() ? icon("check") : null,
          ),
        ),
      ),
    ),
  ]);
}

function openAlignSheet() {
  const now = currentAlign();
  const option = (id: string, label: LabelKey) =>
    keepFocus(
      h(
        "button",
        { type: "button", class: `tile${now === id ? " is-active" : ""}`, onclick: () => (closeSheet(), chain().setTextAlign(id).run()) },
        icon(ALIGN_ICONS[id]!),
        h("span", {}, L(label)),
      ),
    );
  openSheet(L("align"), [
    h("div", { class: "tiles" }, option("left", "alignLeft"), option("center", "alignCenter"), option("right", "alignRight"), option("justify", "justify")),
    h(
      "div",
      { class: "tiles" },
      keepFocus(h("button", { type: "button", class: "tile", onclick: () => chain().outdentBlock().run() }, icon("indent-decrease"), h("span", {}, L("outdent")))),
      keepFocus(h("button", { type: "button", class: "tile", onclick: () => chain().indentBlock().run() }, icon("indent-increase"), h("span", {}, L("indent")))),
    ),
  ]);
}

function openColorSheet(kind: "color" | "highlight") {
  const attrs = editor.getAttributes("textStyle");
  const now = ((kind === "color" ? attrs.color : attrs.backgroundColor) as string | undefined)?.toLowerCase() ?? null;
  const apply = (c: string | null) => {
    closeSheet();
    if (kind === "color") (c ? chain().setColor(c) : chain().unsetColor()).run();
    else (c ? chain().setBackgroundColor(c) : chain().unsetBackgroundColor()).run();
  };
  openSheet(L(kind), [
    h(
      "div",
      { class: "palette" },
      PALETTE.flat().map((c) =>
        keepFocus(
          h("button", {
            type: "button",
            class: `dot${now === c ? " is-active" : ""}`,
            style: { background: c },
            title: c,
            "aria-label": c,
            onclick: () => apply(c),
          }),
        ),
      ),
    ),
    keepFocus(h("button", { type: "button", class: "action", onclick: () => apply(null) }, icon("x"), L("none"))),
  ]);
}

function openLinkSheet() {
  const { from, to, empty } = editor.state.selection;
  const href = (editor.getAttributes("link").href as string) ?? "";
  const selected = empty ? "" : editor.state.doc.textBetween(from, to, " ");
  const address = field(L("linkAddress"), { value: href, inputmode: "url", placeholder: "https://" });
  const text = field(L("linkText"), { value: selected, autocapitalize: "sentences", autocorrect: "on", spellcheck: "true" });
  const apply = () => {
    const url = linkHref(address.input.value);
    const words = text.input.value;
    closeSheet();
    if (!url) {
      chain().extendMarkRange("link").unsetLink().run();
      return;
    }
    if (words && words !== selected) {
      chain()
        .extendMarkRange("link")
        .insertContent({ type: "text", text: words, marks: [{ type: "link", attrs: { href: url } }] })
        .run();
    } else if (empty && !editor.isActive("link")) {
      chain()
        .insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] })
        .run();
    } else {
      chain().extendMarkRange("link").setLink({ href: url }).run();
    }
  };
  submitOnEnter([address.input, text.input], apply);
  const actions = [primary(L("apply"), apply)];
  if (href) actions.unshift(secondary(L("removeLink"), () => (closeSheet(), chain().extendMarkRange("link").unsetLink().run()), true));
  openSheet(L("link"), [address.el, text.el], actions);
  address.input.focus();
}

// Pictures chosen from the phone: the app uploads them and answers with the address, by this id.
const pendingImages = new Map<string, number>();
let uploads = 0;

function openImageSheet() {
  const address = field(L("imageAddress"), { inputmode: "url", placeholder: "https://" });
  const alt = field(L("imageDescription"), { placeholder: L("describeImage"), autocapitalize: "sentences", autocorrect: "on", spellcheck: "true" });
  const apply = () => {
    const src = address.input.value.trim();
    if (!src) return address.input.focus();
    closeSheet();
    chain().setImage({ src, alt: alt.input.value.trim() || undefined }).run();
  };
  submitOnEnter([address.input, alt.input], apply);
  const actions = [primary(L("insert"), apply)];
  if (config.canPickImage) {
    actions.unshift(
      secondary(L("choosePhoto"), () => {
        closeSheet();
        const id = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingImages.set(id, editor.state.selection.from);
        uploads += 1;
        refresh();
        send({ type: "pickImage", id });
      }),
    );
  }
  openSheet(L("image"), [address.el, alt.el], actions);
}

function imageArrived(message: { id?: string; src?: string; alt?: string; error?: string }) {
  const at = message.id ? pendingImages.get(message.id) : undefined;
  if (message.id && at === undefined) return;
  if (message.id) {
    pendingImages.delete(message.id);
    uploads = Math.max(0, uploads - 1);
  }
  if (message.src) {
    const pos = Math.min(at ?? editor.state.selection.from, editor.state.doc.content.size);
    chain()
      .insertContentAt(pos, { type: "image", attrs: { src: message.src, alt: message.alt || null } })
      .run();
  } else if (message.error !== undefined) {
    flash(message.error || L("uploadFailed"));
  }
  refresh();
}

function openAltSheet() {
  const image = selectedImage();
  if (!image) return;
  const alt = field(L("imageDescription"), {
    value: (image.attrs.alt as string) ?? "",
    placeholder: L("describeImage"),
    autocapitalize: "sentences",
    autocorrect: "on",
    spellcheck: "true",
  });
  const apply = () => {
    closeSheet();
    chain().updateAttributes("image", { alt: alt.input.value.trim() || null }).run();
  };
  submitOnEnter([alt.input], apply);
  openSheet(L("imageDescription"), [alt.el], [primary(L("apply"), apply)]);
  alt.input.focus();
}

function openVideoSheet() {
  const address = field(L("videoAddress"), { inputmode: "url", placeholder: "https://youtube.com/watch?v=…" });
  const note = problem();
  const apply = () => {
    const url = address.input.value.trim();
    if (!videoEmbedUrl(url)) return show(note, L("videoUnsupported"));
    closeSheet();
    chain().insertVideo(url).run();
  };
  submitOnEnter([address.input], apply);
  openSheet(L("video"), [address.el, note], [primary(L("insert"), apply)]);
  address.input.focus();
}

function openCtaSheet() {
  const label = field(L("ctaLabel"), { autocapitalize: "sentences", autocorrect: "on", spellcheck: "true" });
  const address = field(L("ctaAddress"), { inputmode: "url", placeholder: "https://" });
  const apply = () => {
    const href = linkHref(address.input.value);
    if (!href) return address.input.focus();
    closeSheet();
    chain().insertCta({ href, label: label.input.value.trim() }).run();
  };
  submitOnEnter([label.input, address.input], apply);
  openSheet(L("cta"), [label.el, address.el], [primary(L("insert"), apply)]);
  label.input.focus();
}

function openProductSheet() {
  const name = field(L("productName"), { autocapitalize: "words", autocorrect: "on", spellcheck: "true" });
  const description = field(L("productDescription"), { autocapitalize: "sentences", autocorrect: "on", spellcheck: "true" });
  const image = field(L("productImage"), { inputmode: "url", placeholder: "https://" });
  const price = field(L("productPrice"), { inputmode: "decimal", placeholder: "19.99" });
  const currency = field(L("productCurrency"), { value: "USD", autocapitalize: "characters", maxlength: 3 });
  const link = field(L("productLink"), { inputmode: "url", placeholder: "https://" });
  const button = field(L("productButton"), { value: L("productDefaultButton"), autocapitalize: "sentences" });
  const note = problem();
  const apply = () => {
    if (!name.input.value.trim()) return name.input.focus();
    const href = linkHref(link.input.value);
    const picture = image.input.value.trim();
    if ((href && !/^https?:\/\//i.test(href)) || (picture && !/^https?:\/\//i.test(picture))) return show(note, "https://");
    closeSheet();
    chain()
      .insertProduct({
        name: name.input.value.trim(),
        description: description.input.value.trim(),
        image: picture,
        price: price.input.value.trim(),
        currency: currency.input.value.trim().toUpperCase(),
        priceText: formatPrice(price.input.value, currency.input.value),
        href,
        label: button.input.value.trim() || L("productDefaultButton"),
      })
      .run();
  };
  openSheet(L("product"), [name.el, description.el, image.el, h("div", { class: "row" }, price.el, currency.el), link.el, button.el, note], [
    primary(L("insert"), apply),
  ]);
  name.input.focus();
}

function openRecipeSheet() {
  const name = field(L("recipeName"), { autocapitalize: "words", autocorrect: "on", spellcheck: "true" });
  const image = field(L("recipeImage"), { inputmode: "url", placeholder: "https://" });
  const servings = field(L("recipeServings"), { inputmode: "numeric" });
  const prep = field(L("recipePrepMinutes"), { inputmode: "numeric" });
  const cook = field(L("recipeCookMinutes"), { inputmode: "numeric" });
  const ingredients = area(L("recipeIngredients"));
  const steps = area(L("recipeSteps"));
  const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
  const minutes = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : null);
  const apply = () => {
    if (!name.input.value.trim()) return name.input.focus();
    closeSheet();
    chain()
      .insertRecipe({
        name: name.input.value.trim(),
        image: image.input.value.trim(),
        servings: servings.input.value.trim(),
        prepMinutes: minutes(prep.input.value),
        cookMinutes: minutes(cook.input.value),
        ingredients: lines(ingredients.input.value),
        steps: lines(steps.input.value),
        labels: {
          ...DEFAULT_RECIPE_LABELS,
          serves: L("recipeServes"),
          prep: L("recipePrep"),
          cook: L("recipeCook"),
          minutes: labels.recipeMinutes,
          ingredients: L("recipeIngredientsHeading"),
          steps: L("recipeStepsHeading"),
        },
      })
      .run();
  };
  openSheet(L("recipe"), [name.el, image.el, h("div", { class: "row" }, servings.el, prep.el, cook.el), ingredients.el, steps.el], [
    primary(L("insert"), apply),
  ]);
  name.input.focus();
}

function openInsertSheet() {
  const tile = (iconName: string, label: LabelKey, run: () => void) =>
    keepFocus(h("button", { type: "button", class: "tile", onclick: run }, icon(iconName), h("span", {}, L(label))));
  const now = (run: () => void) => () => (closeSheet(), run());
  openSheet(L("insertMenu"), [
    h(
      "div",
      { class: "tiles tiles-grid" },
      tile("image", "image", now(openImageSheet)),
      tile("table", "table", now(() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())),
      tile("square-play", "video", now(openVideoSheet)),
      tile("mouse-pointer-click", "cta", now(openCtaSheet)),
      tile("minus", "divider", now(() => chain().setHorizontalRule().run())),
      tile("square-code", "codeBlock", now(() => chain().toggleCodeBlock().run())),
      tile("columns-2", "columns2", now(() => chain().insertColumns(2).run())),
      tile("columns-3", "columns3", now(() => chain().insertColumns(3).run())),
      tile("shopping-bag", "product", now(openProductSheet)),
      tile("chef-hat", "recipe", now(openRecipeSheet)),
    ),
  ]);
}

function chips<T>(items: T[], name: (t: T) => string, isActive: (t: T) => boolean, run: (t: T) => void, style?: (t: T) => Record<string, string>) {
  return h(
    "div",
    { class: "chips" },
    items.map((item) =>
      keepFocus(
        h("button", { type: "button", class: `chip${isActive(item) ? " is-active" : ""}`, style: style?.(item), onclick: () => run(item) }, name(item)),
      ),
    ),
  );
}

function openFormatSheet() {
  const draw = () => {
    const style = editor.getAttributes("textStyle");
    const family = ((style.fontFamily as string) || "").split(",")[0]!.replace(/['"]/g, "").trim().toLowerCase();
    const size = (style.fontSize as string) || "";
    const block = { ...editor.getAttributes("paragraph"), ...editor.getAttributes("heading") };
    const lineHeight = (block.lineHeight as string) || "";
    const fontOf = (f: (typeof FONTS)[number]) => f.value.split(",")[0]!.replace(/['"]/g, "").trim().toLowerCase();
    const CASES: Record<TextCase, LabelKey> = { sentence: "caseSentence", lower: "caseLower", upper: "caseUpper", title: "caseTitle" };
    const again = (run: () => void) => () => (run(), draw());
    const marks = [
      { id: "code", icon: "code", label: "code" as LabelKey, run: () => chain().toggleCode().run() },
      { id: "subscript", icon: "subscript", label: "sub" as LabelKey, run: () => chain().toggleSubscript().run() },
      { id: "superscript", icon: "superscript", label: "sup" as LabelKey, run: () => chain().toggleSuperscript().run() },
    ];
    const sheet = openSheet(L("format"), [
      h(
        "div",
        { class: "tiles" },
        marks.map((m) =>
          keepFocus(
            h(
              "button",
              { type: "button", class: `tile${editor.isActive(m.id) ? " is-active" : ""}`, onclick: again(m.run) },
              icon(m.icon),
              h("span", {}, L(m.label)),
            ),
          ),
        ),
        keepFocus(
          h(
            "button",
            { type: "button", class: "tile", onclick: again(() => chain().unsetAllMarks().clearNodes().run()) },
            icon("remove-formatting"),
            h("span", {}, L("clear")),
          ),
        ),
      ),
      h("div", { class: "group-label" }, L("font")),
      chips(
        [null, ...FONTS],
        (f) => (f ? f.name : L("defaultValue")),
        (f) => (f ? fontOf(f) === family : !family),
        (f) => again(() => (f ? chain().setFontFamily(f.value) : chain().unsetFontFamily()).run())(),
        (f) => (f ? { fontFamily: f.value } : {}),
      ),
      h("div", { class: "group-label" }, L("size")),
      chips(
        [null, ...SIZES],
        (s) => (s ? String(s) : L("defaultValue")),
        (s) => (s ? size === `${s}px` : !size),
        (s) => again(() => (s ? chain().setFontSize(`${s}px`) : chain().unsetFontSize()).run())(),
      ),
      h("div", { class: "group-label" }, L("lineHeight")),
      chips(
        [null, ...LINE_HEIGHTS],
        (v) => v ?? L("defaultValue"),
        (v) => (v ? lineHeight === v : !lineHeight),
        (v) => again(() => chain().setLineHeight(v).run())(),
      ),
      h("div", { class: "group-label" }, L("textCase")),
      chips(
        TEXT_CASES,
        (c) => L(CASES[c]),
        () => false,
        (c) => {
          editor.commands.focus();
          changeCase(editor, c);
        },
      ),
    ]);
    sheet.classList.add("sheet-tall");
  };
  draw();
}

// ---------------------------------------------------------------------------------------------------------
// Find and replace.

const findInput = h("input", { class: "input", type: "search", placeholder: L("findPlaceholder"), autocapitalize: "off", autocorrect: "off" });
const replaceInput = h("input", { class: "input", type: "text", placeholder: L("replacePlaceholder"), autocapitalize: "off", autocorrect: "off" });
const findCount = h("span", { class: "find-count" });
let caseSensitive = false;
const caseButton = h("button", { type: "button", class: "chip", onclick: () => ((caseSensitive = !caseSensitive), runFind()) }, "Aa");

function runFind() {
  editor.commands.setFind(findInput.value, caseSensitive);
  caseButton.classList.toggle("is-active", caseSensitive);
  drawFindCount();
}

function drawFindCount() {
  const state = findKey.getState(editor.state);
  const n = state?.matches.length ?? 0;
  findCount.textContent = !findInput.value ? "" : n ? L("matchCount", { i: (state?.index ?? 0) + 1, n }) : L("noMatches");
}

function buildFindbar() {
  findInput.placeholder = L("findPlaceholder");
  replaceInput.placeholder = L("replacePlaceholder");
  findbar.replaceChildren(
    h(
      "div",
      { class: "find-row" },
      findInput,
      findCount,
      caseButton,
      h("button", { type: "button", class: "btn", "aria-label": L("previous"), onclick: () => (editor.commands.findPrev(), drawFindCount()) }, icon("chevron-up")),
      h("button", { type: "button", class: "btn", "aria-label": L("next"), onclick: () => (editor.commands.findNext(), drawFindCount()) }, icon("chevron-down")),
      h("button", { type: "button", class: "btn", "aria-label": L("close"), onclick: () => toggleFind(false) }, icon("x")),
    ),
    h(
      "div",
      { class: "find-row" },
      replaceInput,
      h("button", { type: "button", class: "chip", onclick: () => (editor.commands.replaceCurrent(replaceInput.value), drawFindCount()) }, L("replace")),
      h("button", { type: "button", class: "chip", onclick: () => (editor.commands.replaceAll(replaceInput.value), drawFindCount()) }, L("replaceAll")),
    ),
  );
}
findInput.addEventListener("input", runFind);
findInput.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  if (e.shiftKey) editor.commands.findPrev();
  else editor.commands.findNext();
  drawFindCount();
});

function toggleFind(open = findbar.hidden) {
  findbar.hidden = !open;
  if (open) {
    buildFindbar();
    const { from, to, empty } = editor.state.selection;
    if (!empty && !findInput.value) findInput.value = editor.state.doc.textBetween(from, to, " ");
    runFind();
    findInput.focus();
  } else {
    editor.commands.setFind("", false);
    editor.commands.focus();
  }
  refresh();
}

// ---------------------------------------------------------------------------------------------------------
// Keeping the toolbar, the row and the count in step with the document.

let flashText = "";
let flashTimer: number | undefined;
function flash(text: string) {
  flashText = text;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => ((flashText = ""), refresh()), 4000);
  refresh();
}

let lastState = "";
let pending = false;
function refresh() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    const editable = editor.isEditable;
    bar.hidden = !editable;
    for (const { el, tool, swatch, text } of buttons.values()) {
      const active = tool.active?.() ?? false;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-pressed", String(active));
      el.disabled = tool.enabled ? !tool.enabled() : false;
      if (swatch) {
        const c = tool.swatch!();
        swatch.style.background = c ?? "transparent";
        swatch.classList.toggle("is-empty", !c);
      }
      if (text) text.textContent = tool.text!();
    }
    const align = buttons.get("align");
    if (align) align.el.querySelector(".ic")!.innerHTML = ICONS[ALIGN_ICONS[currentAlign()]!] ?? "";
    renderContext();
    if (!findbar.hidden) drawFindCount();

    const storage = editor.storage as unknown as { characterCount: { words(): number; characters(): number } };
    const words = storage.characterCount.words();
    const chars = storage.characterCount.characters();
    const status = flashText || (uploads ? L("uploading") : "");
    footer.textContent = status || config.footer || L("count", { words, chars });
    footer.classList.toggle("is-status", Boolean(status));
    const state = JSON.stringify({ words, chars, canUndo: editor.can().undo(), canRedo: editor.can().redo() });
    if (state !== lastState) {
      lastState = state;
      send({ type: "state", ...JSON.parse(state) });
    }
  });
}
editor.on("transaction", refresh);
editor.on("focus", refresh);
editor.on("blur", refresh);

// ---------------------------------------------------------------------------------------------------------
// Messages from the app.

const parse = (data: unknown) => (typeof data === "string" ? (data ? JSON.parse(data) : {}) : (data ?? {}));

function command(message: { type?: string; name?: string; args?: unknown[]; [key: string]: unknown }) {
  switch (message.type) {
    case "focus":
      editor.commands.focus();
      break;
    case "blur":
      editor.commands.blur();
      break;
    case "image":
      imageArrived(message);
      break;
    case "exec": {
      const run = (chain() as unknown as Record<string, (...args: unknown[]) => ChainedCommands>)[message.name ?? ""];
      if (typeof run === "function") run.apply(null, message.args ?? []).run();
      break;
    }
  }
}

host.px = {
  receive(message) {
    try {
      if (message.type === "value") applyValue(parse(message.data));
      else if (message.type === "config") applyConfig(parse(message.data));
      else if (message.type === "post") command(parse(message.data));
    } catch (error) {
      console.error("pyxpo-rich-editor:", error);
    }
  },
};

window.addEventListener("message", (e) => {
  const data = e.data as { __pxRichIn?: { type: string; data?: unknown } } | null;
  if (data && data.__pxRichIn) host.px!.receive(data.__pxRichIn);
});

applyConfig({});
send({ type: "ready" });
