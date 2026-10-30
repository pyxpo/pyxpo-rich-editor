import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import type { Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Find and replace over the document, as the find bar drives it.
 *
 * Every match is painted with a decoration, the current one in a stronger
 * colour, and the current one is also selected and scrolled to, so the caret
 * is where the person was looking when they close the bar. Matches never
 * cross from one paragraph into the next, as in a word processor.
 */

interface Match {
  from: number;
  to: number;
}

export interface FindState {
  query: string;
  caseSensitive: boolean;
  matches: Match[];
  index: number;
  decorations: DecorationSet;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    findReplace: {
      setFind: (query: string, caseSensitive: boolean) => ReturnType;
      findNext: () => ReturnType;
      findPrev: () => ReturnType;
      replaceCurrent: (text: string) => ReturnType;
      replaceAll: (text: string) => ReturnType;
    };
  }
}

export const findKey = new PluginKey<FindState>("find");

// One UTF-16 unit in, one out: a letter whose lower case is longer (İ) is compared as it is, so the
// positions below stay one to one with the document's.
const fold = (ch: string) => {
  const lower = ch.toLowerCase();
  return lower.length === 1 ? lower : ch;
};

function search(doc: PMNode, query: string, caseSensitive: boolean) {
  const matches: Match[] = [];
  if (!query) return matches;
  const needle = caseSensitive ? query : [...query].map(fold).join("");
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const at: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const value = child.text!;
        for (let i = 0; i < value.length; i++) {
          text += caseSensitive ? value[i] : fold(value[i]!);
          at.push(start + i);
        }
      } else {
        // A picture or a break inside the line: one place, never part of a match.
        text += "￼";
        at.push(start);
      }
    });
    for (
      let i = text.indexOf(needle);
      i !== -1;
      i = text.indexOf(needle, i + needle.length)
    )
      matches.push({ from: at[i]!, to: at[i + needle.length - 1]! + 1 });
    return false;
  });
  return matches;
}

const paint = (doc: PMNode, matches: Match[], index: number) =>
  DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === index ? "find-match find-match-current" : "find-match",
      }),
    ),
  );

const wrap = (index: number, count: number) =>
  count ? ((index % count) + count) % count : 0;

/** Selects a match and scrolls the page to it. */
const select = (tr: Transaction, match: Match | undefined) => {
  if (match)
    tr.setSelection(
      TextSelection.create(tr.doc, match.from, match.to),
    ).scrollIntoView();
};

/** The first match at or after `pos`, wrapping round to the first. */
const nextFrom = (matches: Match[], pos: number) =>
  Math.max(
    0,
    matches.findIndex((m) => m.from >= pos),
  );

export const FindReplace = Extension.create({
  name: "findReplace",

  addCommands() {
    return {
      setFind:
        (query, caseSensitive) =>
        ({ state, tr, dispatch }) => {
          if (dispatch) {
            const matches = search(state.doc, query, caseSensitive);
            const index = nextFrom(matches, state.selection.from);
            tr.setMeta(findKey, { query, caseSensitive, index });
            select(tr, matches[index]);
          }
          return true;
        },
      findNext:
        () =>
        ({ state, tr, dispatch }) => {
          const find = findKey.getState(state);
          if (!find?.matches.length) return false;
          if (dispatch) {
            const index = wrap(find.index + 1, find.matches.length);
            tr.setMeta(findKey, { index });
            select(tr, find.matches[index]);
          }
          return true;
        },
      findPrev:
        () =>
        ({ state, tr, dispatch }) => {
          const find = findKey.getState(state);
          if (!find?.matches.length) return false;
          if (dispatch) {
            const index = wrap(find.index - 1, find.matches.length);
            tr.setMeta(findKey, { index });
            select(tr, find.matches[index]);
          }
          return true;
        },
      replaceCurrent:
        (text) =>
        ({ state, tr, dispatch }) => {
          const find = findKey.getState(state);
          const match = find?.matches[find.index];
          if (!find || !match) return false;
          if (dispatch) {
            tr.insertText(text, match.from, match.to);
            // On to the next match after the new text, which may itself contain what was searched for.
            const matches = search(tr.doc, find.query, find.caseSensitive);
            const index = nextFrom(matches, match.from + text.length);
            tr.setMeta(findKey, { index });
            select(tr, matches[index]);
          }
          return true;
        },
      replaceAll:
        (text) =>
        ({ state, tr, dispatch }) => {
          const find = findKey.getState(state);
          if (!find?.matches.length) return false;
          // Back to front, so each replacement leaves the positions before it as they were.
          if (dispatch)
            for (const m of [...find.matches].reverse())
              tr.insertText(text, m.from, m.to);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FindState>({
        key: findKey,
        state: {
          init: () => ({
            query: "",
            caseSensitive: false,
            matches: [],
            index: 0,
            decorations: DecorationSet.empty,
          }),
          apply(tr, prev, _old, next) {
            const meta = tr.getMeta(findKey) as
              | Partial<Pick<FindState, "query" | "caseSensitive" | "index">>
              | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
            if (!query)
              return {
                ...prev,
                query,
                matches: [],
                index: 0,
                decorations: DecorationSet.empty,
              };
            const matches = search(next.doc, query, caseSensitive);
            const index = wrap(meta?.index ?? prev.index, matches.length);
            return {
              query,
              caseSensitive,
              matches,
              index,
              decorations: paint(next.doc, matches, index),
            };
          },
        },
        props: {
          decorations: (state) => findKey.getState(state)?.decorations,
        },
      }),
    ];
  },
});
