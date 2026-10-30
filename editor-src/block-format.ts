import { Extension, type CommandProps } from "@tiptap/core";

/**
 * Paragraph settings a word processor has and the schema did not: line
 * spacing and indent, for paragraphs and headings.
 *
 * Both are written as inline style (`line-height`, `margin-left`), next to the
 * `text-align` the alignment extension writes, so the published post keeps
 * them. The sanitisers (`safe-html.ts`, the API's `render-html.ts`) allow
 * exactly the values offered here and nothing else.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockFormat: {
      /** Line spacing for the selected blocks; null goes back to the theme's. */
      setLineHeight: (value: string | null) => ReturnType;
      /** One step in: a list item moves a level down, any other block gains 40px. */
      indentBlock: () => ReturnType;
      outdentBlock: () => ReturnType;
    };
  }
}

export const LINE_HEIGHTS = ["1", "1.15", "1.5", "2", "2.5", "3"];
const TYPES = ["paragraph", "heading"];
const INDENT_STEP = 40;
const MAX_INDENT = 5;

/** Moves every selected paragraph and heading `delta` steps, within 0 to MAX_INDENT. */
const shiftIndent =
  (delta: number) =>
  ({ state, tr, dispatch }: CommandProps) => {
    const { from, to } = state.selection;
    let changed = false;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!TYPES.includes(node.type.name)) return true;
      const current = (node.attrs.indent as number) ?? 0;
      const next = Math.min(MAX_INDENT, Math.max(0, current + delta));
      if (next !== current) {
        changed = true;
        if (dispatch) tr.setNodeAttribute(pos, "indent", next);
      }
      return false;
    });
    return changed;
  };

export const BlockFormat = Extension.create({
  name: "blockFormat",

  addGlobalAttributes() {
    return [
      {
        types: TYPES,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (el) =>
              LINE_HEIGHTS.includes(el.style.lineHeight)
                ? el.style.lineHeight
                : null,
            renderHTML: (attrs) =>
              LINE_HEIGHTS.includes(attrs.lineHeight as string)
                ? { style: `line-height: ${attrs.lineHeight}` }
                : {},
          },
          indent: {
            default: 0,
            parseHTML: (el) => {
              const px = parseInt(el.style.marginLeft, 10);
              if (!Number.isFinite(px) || px <= 0) return 0;
              return Math.min(MAX_INDENT, Math.round(px / INDENT_STEP));
            },
            renderHTML: (attrs) => {
              const level = attrs.indent as number;
              return level > 0
                ? { style: `margin-left: ${level * INDENT_STEP}px` }
                : {};
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (value) =>
        ({ commands }) =>
          TYPES.map((type) =>
            commands.updateAttributes(type, {
              lineHeight: value && LINE_HEIGHTS.includes(value) ? value : null,
            }),
          ).some(Boolean),
      indentBlock: () => (props) =>
        props.editor.isActive("listItem")
          ? props.commands.sinkListItem("listItem")
          : shiftIndent(1)(props),
      outdentBlock: () => (props) =>
        props.editor.isActive("listItem")
          ? props.commands.liftListItem("listItem")
          : shiftIndent(-1)(props),
    };
  },

  // Ctrl+] and Ctrl+[, as in Google Docs. Tab is left to lists and to leaving the page by keyboard.
  addKeyboardShortcuts() {
    return {
      "Mod-]": () => this.editor.commands.indentBlock(),
      "Mod-[": () => this.editor.commands.outdentBlock(),
    };
  },
});
