import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchHighlight: {
      /** Highlights every occurrence of these (case-insensitive) terms. An empty list clears it. */
      setSearchTerms: (terms: string[]) => ReturnType;
    };
  }
}

type State = { terms: string[]; decorations: DecorationSet };
const key = new PluginKey<State>('searchHighlight');

function find(doc: PMNode, terms: string[]) {
  if (!terms.length) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text!.toLowerCase();
    for (const term of terms) {
      for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + term.length)) {
        decorations.push(Decoration.inline(pos + i, pos + i + term.length, { class: 'search-match' }));
      }
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** Marks the sidebar search terms inside the open note. Decorations only; the note is untouched. */
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',

  addCommands() {
    return {
      setSearchTerms: (terms) => ({ tr, dispatch }) => {
        if (dispatch) tr.setMeta(key, terms.map((t) => t.toLowerCase()).filter(Boolean));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [new Plugin<State>({
      key,
      state: {
        init: () => ({ terms: [], decorations: DecorationSet.empty }),
        apply(tr, prev) {
          const terms = tr.getMeta(key) as string[] | undefined;
          if (terms) return { terms, decorations: find(tr.doc, terms) };
          if (tr.docChanged && prev.terms.length) return { ...prev, decorations: find(tr.doc, prev.terms) };
          return prev;
        },
      },
      props: { decorations: (state) => key.getState(state)?.decorations },
    })];
  },
});
