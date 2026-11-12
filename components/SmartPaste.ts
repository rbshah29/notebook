import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import { detectCode } from '@/lib/code';
import { parsePaste, type PasteBlock } from '@/lib/paste';

export function toNodes(schema: Schema, block: PasteBlock): PMNode[] {
  const { paragraph, table, tableRow, tableHeader, tableCell, codeBlock } = schema.nodes;
  const para = (text: string) => paragraph.create(null, text ? schema.text(text) : undefined);

  if (block.type === 'table') {
    const cols = Math.max(...block.rows.map((r) => r.length));
    return [table.create(null, block.rows.map((row, r) => tableRow.create(null,
      Array.from({ length: cols }, (_, c) =>
        (block.header && r === 0 ? tableHeader : tableCell).create(null, para(row[c] ?? '')))))) ];
  }
  if (block.type === 'pre') return [codeBlock.create({ language: 'plaintext' }, schema.text(block.text))];
  return block.lines.map((line) => para(line.trim()));
}

/**
 * Pasting plain text that was laid out for a monospace font (terminal tables, markdown tables,
 * tree diagrams…) would otherwise collapse into paragraphs and lose its alignment. Tables become
 * real tables; other aligned text becomes a plain-text code block. Runs before the code-paste
 * handler, which would otherwise claim indented terminal output as code.
 */
export const SmartPaste = Extension.create({
  name: 'smartPaste',
  priority: 200,

  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey('smartPaste'),
      props: {
        handlePaste: (view, event) => {
          const data = event.clipboardData;
          const { schema, selection } = view.state;
          if (!data || selection.$from.parent.type.spec.code || data.files.length) return false;
          if (data.getData('vscode-editor-data')) return false;
          // Rich HTML keeps its own structure, unless it's preformatted text.
          const html = data.getData('text/html');
          if (html && (/<table[\s>]/i.test(html) || !/<pre[\s>]|white-space:\s*pre/i.test(html))) return false;
          const text = data.getData('text/plain');
          if (!text.trim()) return false;

          const blocks = parsePaste(text);
          const hasTable = blocks.some((b) => b.type === 'table');
          const hasPre = blocks.some((b) => b.type === 'pre');
          // Pure source code is the code-paste handler's job (it also guesses the language).
          if (!hasTable && (!hasPre || detectCode(text))) return false;

          const nodes = blocks.flatMap((b) => toNodes(schema, b));
          const open = (n: PMNode) => (n.type === schema.nodes.paragraph ? 1 : 0);
          const slice = new Slice(Fragment.from(nodes), open(nodes[0]), open(nodes[nodes.length - 1]));
          view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView()
            .setMeta('paste', true).setMeta('uiEvent', 'paste'));
          return true;
        },
      },
    })];
  },
});
