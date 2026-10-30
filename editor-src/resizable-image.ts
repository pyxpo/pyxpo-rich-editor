import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";

/**
 * A picture that can be made smaller and pushed to one side.
 *
 * Tiptap's image is a source and nothing else, which leaves every photo
 * full width in a column of text -- the first thing anybody tries to change,
 * and the reason a word processor puts handles on the corners.
 *
 * Both answers are written as inline styles on the `img` rather than as
 * classes, because this HTML is served by the customer's own site. A class
 * means nothing there unless they were told to add a stylesheet, and they
 * were not. A percentage rather than pixels for the same reason: the post is
 * read on a phone, and a 900px image inside a 380px column is a horizontal
 * scrollbar in somebody else's blog.
 */
export type ImageAlign = "left" | "center" | "right";

const MARGIN: Record<ImageAlign, string> = {
  left: "margin-right: auto",
  center: "margin-left: auto; margin-right: auto",
  right: "margin-left: auto",
};

/**
 * The grips, and which way each one grows the picture.
 *
 * Only the width is ever set -- the height follows it, because a photo
 * stretched out of its own proportions is never what was wanted. So the two
 * side grips do the same work as the two bottom corners, and exist because
 * that is where a hand goes.
 */
const HANDLES: { corner: string; sign: number }[] = [
  { corner: "e", sign: 1 },
  { corner: "w", sign: -1 },
  { corner: "se", sign: 1 },
  { corner: "sw", sign: -1 },
];

/** The smallest a picture may be dragged, as a percentage of the column. */
const MIN_PERCENT = 10;

function styleOf(attrs: { width?: string | null; align?: ImageAlign | null }): string {
  return ["display: block", attrs.width ? `width: ${attrs.width}` : null, MARGIN[attrs.align ?? "left"]]
    .filter(Boolean)
    .join("; ");
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // Both are rendered by `renderHTML` below, as one style attribute.
      // Returning anything here would mean two `style` keys, and the second
      // silently wins.
      width: {
        default: null,
        parseHTML: (element) => {
          const inline = (element as HTMLElement).style.width;
          if (inline) return inline;
          const attr = element.getAttribute("width");
          return attr ? `${attr}px` : null;
        },
        renderHTML: () => ({}),
      },
      align: {
        default: "left",
        parseHTML: (element) => {
          const { marginLeft, marginRight } = (element as HTMLElement).style;
          if (marginLeft === "auto" && marginRight === "auto") return "center";
          if (marginLeft === "auto") return "right";
          return "left";
        },
        renderHTML: () => ({}),
      },
    };
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        style: styleOf(node.attrs as { width?: string | null; align?: ImageAlign | null }),
      }),
    ];
  },

  /**
   * The handle, and the drag.
   *
   * Plain DOM rather than a React node view: this is one element and two
   * listeners, and a React renderer for it would pull a second reconciler into
   * the editor for no behaviour. Pointer events rather than mouse events, so
   * the handle works under a finger.
   */
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "rich-image";
      // ProseMirror moves the node itself once its own view is draggable: the
      // picture can be picked up and dropped between paragraphs, with the drop
      // marker and the undo step it already knows how to make.
      dom.draggable = true;
      const img = document.createElement("img");
      img.draggable = false;
      dom.append(img);

      const grips = HANDLES.map(({ corner, sign }) => {
        const grip = document.createElement("span");
        grip.className = `rich-image-handle rich-image-handle--${corner}`;
        grip.dataset.grip = corner;
        grip.setAttribute("aria-hidden", "true");
        grip.addEventListener("pointerdown", (event) => startResize(event, sign));
        dom.append(grip);
        return grip;
      });

      const apply = (attrs: Record<string, unknown>) => {
        img.src = String(attrs.src ?? "");
        img.alt = String(attrs.alt ?? "");
        dom.style.width = (attrs.width as string) || "100%";
        dom.dataset.align = (attrs.align as string) || "left";
      };
      apply(node.attrs);

      const at = (): number | null => {
        if (typeof getPos !== "function") return null;
        const pos = getPos();
        return pos === undefined ? null : pos;
      };

      // Clicking a picture selects it, which is what puts the handles and the
      // size and side buttons in front of somebody.
      const select = () => {
        const pos = at();
        if (pos !== null) editor.commands.setNodeSelection(pos);
      };
      // On click rather than mousedown: mousedown is where ProseMirror starts
      // a drag of this node, and taking that event from it is what stopped the
      // picture being draggable at all. A click does not fire after a drag, so
      // the two gestures no longer share an entry point.
      dom.addEventListener("click", select);

      let startX = 0;
      let startWidth = 0;
      let columnWidth = 0;
      let direction = 1;

      const move = (event: PointerEvent) => {
        const wanted = ((startWidth + direction * (event.clientX - startX)) / columnWidth) * 100;
        dom.style.width = `${Math.round(Math.min(100, Math.max(MIN_PERCENT, wanted)))}%`;
      };

      const stop = () => {
        document.removeEventListener("pointermove", move);
        dom.classList.remove("is-resizing");
        const pos = at();
        if (pos === null) return;
        // Written to the document once, at the end. Every intermediate width
        // would be its own undo step, and undo would then walk the drag back
        // one pixel at a time.
        editor.view.dispatch(editor.view.state.tr.setNodeAttribute(pos, "width", dom.style.width));
      };

      function startResize(event: PointerEvent, sign: number) {
        // The picture is being sized, not carried: without this the browser
        // starts a drag of the node the instant the grip moves.
        event.preventDefault();
        event.stopPropagation();
        const column = dom.parentElement?.getBoundingClientRect().width;
        if (!column) return;
        select();
        startX = event.clientX;
        startWidth = img.getBoundingClientRect().width;
        columnWidth = column;
        direction = sign;
        dom.classList.add("is-resizing");
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", stop, { once: true });
      }

      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== node.type.name) return false;
          apply(updated.attrs);
          return true;
        },
        selectNode: () => dom.classList.add("is-selected"),
        deselectNode: () => dom.classList.remove("is-selected"),
        // The width changes on this element as it is dragged. That is our
        // doing, not somebody typing, and redrawing the node view on every
        // frame of a drag would fight the drag.
        ignoreMutation: () => true,
        // Everything on a grip is ours. Everything else -- the drag that moves
        // the picture, the click that selects it -- is ProseMirror's.
        stopEvent: (event) => grips.some((grip) => grip.contains(event.target as Node)),
        destroy: () => document.removeEventListener("pointermove", move),
      };
    };
  },
});
