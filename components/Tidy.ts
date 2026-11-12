import type { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { parsePaste } from '@/lib/paste';
import { toNodes } from './SmartPaste';

const LIST_MARKER = /^([-*+•‣◦▪]|\d{1,3}[.)])\s+/;
const SENTENCE_END = /[.!?:]["')\]’”]?$/;

/**
 * Whether `next` continues the line before it (text hard-wrapped at a fixed width) rather than
 * starting a new paragraph.
 */
const continues = (prev: string, next: string) =>
  /^[a-z(]/.test(next) || /[,;–—]$/.test(prev) || (prev.length >= 60 && !SENTENCE_END.test(prev));

const textOf = (f: Fragment) => f.textBetween(0, f.size, '', '');

/** Collapses runs of spaces inside text and trims the line, keeping marks (bold, links…). */
function clean(line: Fragment, schema: Schema): Fragment {
  const nodes: PMNode[] = [];
  line.forEach((n) => nodes.push(n.isText ? schema.text(n.text!.replace(/[ \t ]{2,}/g, ' '), n.marks) : n));
  const trimmed = nodes.map((n, i) => {
    if (!n.isText) return n;
    let t = n.text!;
    if (i === 0) t = t.trimStart();
    if (i === nodes.length - 1) t = t.trimEnd();
    return t ? schema.text(t, n.marks) : null;
  }).filter((n): n is PMNode => n !== null);
  return Fragment.from(trimmed);
}

const join = (a: Fragment, b: Fragment, schema: Schema) => a.append(Fragment.from(schema.text(' '))).append(b);

/** Prose rules: rejoin hard-wrapped lines, turn `- ` / `1. ` lines into lists, drop blank lines. */
function tidyText(lines: Fragment[], schema: Schema): PMNode[] {
  const { paragraph, bulletList, orderedList, listItem } = schema.nodes;
  const out: PMNode[] = [];
  let para: { content: Fragment; text: string } | null = null;
  let list: { ordered: boolean; start: number; items: { content: Fragment; text: string }[] } | null = null;

  const flushPara = () => {
    if (para) out.push(paragraph.create(null, para.content));
    para = null;
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((i) => listItem.create(null, paragraph.create(null, i.content)));
      out.push(list.ordered ? orderedList.create({ start: list.start }, items) : bulletList.create(null, items));
    }
    list = null;
  };

  for (const raw of lines) {
    const content = clean(raw, schema);
    const text = textOf(content);
    if (!text) { flushPara(); flushList(); continue; }

    const marker = LIST_MARKER.exec(text);
    if (marker) {
      flushPara();
      const ordered = /\d/.test(marker[1]);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, start: ordered ? parseInt(marker[1], 10) : 1, items: [] };
      list.items.push({ content: content.cut(marker[0].length), text: text.slice(marker[0].length) });
      continue;
    }
    if (list) {
      const item = list.items[list.items.length - 1];
      if (continues(item.text, text)) {
        item.content = join(item.content, content, schema);
        item.text += ` ${text}`;
        continue;
      }
      flushList();
    }
    if (para && continues(para.text, text)) {
      para.content = join(para.content, content, schema);
      para.text += ` ${text}`;
    } else {
      flushPara();
      para = { content, text };
    }
  }
  flushPara();
  flushList();
  return out;
}

/** Tables and aligned text first (same rules as pasting), prose rules for the rest. */
function tidyLines(lines: Fragment[], schema: Schema): PMNode[] {
  const blocks = parsePaste(lines.map(textOf).join('\n'));
  return blocks.flatMap((b) => (b.type === 'text'
    ? tidyText(lines.slice(b.from, b.to), schema)
    : toNodes(schema, b)));
}

/** A paragraph's visual lines: hard breaks (Shift+Enter) split it like separate paragraphs. */
function splitAtBreaks(content: Fragment): Fragment[] {
  const lines: Fragment[] = [];
  let current: PMNode[] = [];
  content.forEach((n) => {
    if (n.type.name === 'hardBreak') { lines.push(Fragment.from(current)); current = []; }
    else current.push(n);
  });
  lines.push(Fragment.from(current));
  return lines;
}

export type TidyResult = 'done' | 'unchanged' | 'unsupported';

/**
 * Cleans up the blocks the selection touches. Paragraphs are re-read line by line and rebuilt;
 * headings, lists, tables and code blocks inside the selection are left as they are.
 */
export function tidySelection(editor: Editor): TidyResult {
  const { state } = editor;
  const { schema } = state;
  const range = state.selection.$from.blockRange(state.selection.$to);
  if (!range) return 'unsupported';

  const { parent, startIndex, endIndex } = range;
  const before: PMNode[] = [];
  const after: PMNode[] = [];
  let run: Fragment[] = [];
  const flush = () => {
    if (run.length) after.push(...tidyLines(run, schema));
    run = [];
  };
  for (let i = startIndex; i < endIndex; i++) {
    const node = parent.child(i);
    before.push(node);
    if (node.type === schema.nodes.paragraph) run.push(...splitAtBreaks(node.content));
    else { flush(); after.push(node); }
  }
  flush();

  const fragment = Fragment.from(after);
  if (!after.length || fragment.eq(Fragment.from(before))) return 'unchanged';
  // e.g. a table can't go inside a list item's first paragraph.
  if (!parent.canReplace(startIndex, endIndex, fragment)) return 'unsupported';

  const tr = state.tr.replaceWith(range.start, range.end, fragment);
  tr.setSelection(TextSelection.near(tr.doc.resolve(range.start + fragment.size), -1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
  return 'done';
}
