import { Node } from "@tiptap/core";

/**
 * Markup the schema has no node for -- an embed, a `<details>`, a styled box from another editor -- kept as it
 * was written instead of being flattened into paragraphs. It shows as a grey box with a preview, and comes back
 * out byte for byte, so opening and saving a post never loses what the editor cannot edit.
 *
 * Its rules run last (priority 10): every block the schema knows parses as itself first.
 */
const TAGS = ["div[class]", "div[style]", "figure", "section", "aside", "iframe", "details", "form", "script", "style"];

function fromHtml(html: string): HTMLElement {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  const first = template.content.firstElementChild;
  if (first instanceof HTMLElement) return first;
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

/** The markup as something to look at: scripts, frames and handlers are kept in the post, never run in the editor. */
function safePreview(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, iframe, object, embed, form, link, meta").forEach((el) => el.remove());
  doc.body.querySelectorAll("*").forEach((el) => {
    for (const { name, value } of Array.from(el.attributes)) {
      if (/^on/i.test(name) || /^\s*javascript:/i.test(value)) el.removeAttribute(name);
    }
  });
  const fragment = document.createDocumentFragment();
  fragment.append(...Array.from(doc.body.childNodes));
  return fragment;
}

export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return { html: { default: "", rendered: false } };
  },

  parseHTML() {
    return TAGS.map((tag) => ({
      tag,
      priority: 10,
      getAttrs: (el: HTMLElement | string) => (typeof el === "string" ? false : { html: el.outerHTML }),
    }));
  },

  renderHTML({ node }) {
    return fromHtml(node.attrs.html as string);
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "raw-block";
      dom.contentEditable = "false";
      const label = document.createElement("div");
      label.className = "raw-block__label";
      label.textContent = (window as unknown as { pxLabels?: Record<string, string> }).pxLabels?.htmlBlock ?? "HTML block";
      const preview = document.createElement("div");
      preview.className = "raw-block__preview";
      const html = node.attrs.html as string;
      preview.append(safePreview(html));
      if (!preview.textContent?.trim() && !preview.querySelector("img")) {
        preview.textContent = html.length > 160 ? `${html.slice(0, 160)}…` : html;
      }
      dom.append(label, preview);
      return { dom };
    };
  },
});
