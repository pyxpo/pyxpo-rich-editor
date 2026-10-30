import type { Editor } from "@tiptap/core";
import type { Mark } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";

export type TextCase = "sentence" | "lower" | "upper" | "title";
export const TEXT_CASES: TextCase[] = ["sentence", "lower", "upper", "title"];

const WORD = /[\p{L}\p{N}'’]/u;
const LETTER = /[\p{L}\p{N}]/u;

/**
 * Word's Change Case on the selected text: every run keeps its own bold,
 * colour or link, only its letters change. Each paragraph starts a new
 * sentence and a new word.
 */
export function changeCase(editor: Editor, mode: TextCase) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return false;

  const runs: {
    from: number;
    to: number;
    text: string;
    marks: readonly Mark[];
  }[] = [];
  editor.state.doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return true;
    const start = Math.max(from, pos);
    const end = Math.min(to, pos + node.nodeSize);
    if (end > start)
      runs.push({
        from: start,
        to: end,
        text: node.text!.slice(start - pos, end - pos),
        marks: node.marks,
      });
    return false;
  });

  let prev = " ";
  let sentenceStart = true;
  let lastEnd = -1;
  const changed = runs.map((run) => {
    // A gap between two runs is a paragraph break (or a picture): a new word and a new sentence.
    if (lastEnd !== -1 && run.from !== lastEnd) {
      prev = " ";
      sentenceStart = true;
    }
    lastEnd = run.to;
    let out = "";
    for (const ch of run.text) {
      if (mode === "upper") out += ch.toUpperCase();
      else if (mode === "lower") out += ch.toLowerCase();
      else if (mode === "title")
        out += WORD.test(prev) ? ch.toLowerCase() : ch.toUpperCase();
      else if (LETTER.test(ch)) {
        out += sentenceStart ? ch.toUpperCase() : ch.toLowerCase();
        sentenceStart = false;
      } else {
        out += ch;
        if (/[.!?]/.test(ch)) sentenceStart = true;
      }
      prev = ch;
    }
    return { ...run, out };
  });

  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      // Back to front: each replacement can change length (ß is SS in capitals) without moving the others.
      for (const run of [...changed].reverse())
        if (run.out !== run.text)
          tr.replaceWith(
            run.from,
            run.to,
            editor.schema.text(run.out, run.marks),
          );
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          tr.mapping.map(from, -1),
          tr.mapping.map(to, 1),
        ),
      );
      return true;
    })
    .run();
}
