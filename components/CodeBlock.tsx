'use client';
import { useEffect, useState } from 'react';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Check, Copy } from 'lucide-react';
import { lowlight, LANGUAGES, INDENT, resolveLanguage, dedent, detectCode } from '@/lib/code';

const OPENERS: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

/**
 * Code block with VS Code–style syntax colors, a language picker, Tab / Shift+Tab indentation,
 * Enter that keeps (and after `{`, `:`… adds) indentation, and pastes that arrive as code.
 */
export const CodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Enter: ({ editor }) => {
        const { $from, from, to } = editor.state.selection;
        if ($from.parent.type !== this.type) return false;
        const text = $from.parent.textContent;
        const offset = $from.parentOffset;
        const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
        const before = text.slice(lineStart, offset);

        // Two blank lines at the end leave the block, like the default triple-Enter.
        if (from === to && offset === text.length && !before.trim() && lineStart > 0) {
          const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1;
          if (!text.slice(prevStart, lineStart - 1).trim()) {
            const start = $from.start() + Math.max(0, prevStart - 1);
            return editor.chain().command(({ tr }) => { tr.delete(start, from); return true; }).exitCode().run();
          }
        }

        const indent = /^[ \t]*/.exec(before)![0];
        const last = before.trimEnd().slice(-1);
        const deeper = last in OPENERS || last === ':' ? indent + INDENT : indent;
        const closesNext = OPENERS[last] && text.slice(offset).trimStart().startsWith(OPENERS[last]);
        const insert = closesNext ? `\n${deeper}\n${indent}` : `\n${deeper}`;
        return editor.commands.command(({ tr }) => {
          tr.insertText(insert, from, to);
          tr.setSelection(TextSelection.create(tr.doc, from + 1 + deeper.length));
          return true;
        });
      },
    };
  },

  addProseMirrorPlugins() {
    const type = this.type;
    const paste = new Plugin({
      key: new PluginKey('codePaste'),
      props: {
        handlePaste: (view, event) => {
          const data = event.clipboardData;
          if (!data || view.state.selection.$from.parent.type.spec.code) return false;
          const text = data.getData('text/plain');
          if (!text.trim()) return false;

          let language: string | null;
          const vscode = data.getData('vscode-editor-data');
          if (vscode) {
            try { language = resolveLanguage(JSON.parse(vscode).mode); } catch { language = null; }
          } else {
            // Rich HTML from a web page keeps its own formatting; editors that copy styled
            // `white-space: pre` markup (VS Code, JetBrains…) are treated as plain text.
            const html = data.getData('text/html');
            if (html && !/white-space:\s*pre/.test(html)) return false;
            const guess = detectCode(text);
            if (!guess) return false;
            language = guess.language;
          }

          const { tr, schema } = view.state;
          tr.replaceSelectionWith(type.create({ language }, schema.text(dedent(text))));
          if (tr.selection.$from.parent.type !== type) {
            tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, tr.selection.from - 2)), -1));
          }
          view.dispatch(tr.setMeta('paste', true).scrollIntoView());
          return true;
        },
      },
    });
    return [paste, ...(this.parent?.() ?? [])];
  },
}).configure({
  lowlight,
  enableTabIndentation: true,
  tabSize: INDENT.length,
  exitOnTripleEnter: false,
});

function CodeBlockView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const [copied, setCopied] = useState(false);
  const language = (node.attrs.language as string | null) ?? '';
  const known = !language || LANGUAGES.some((l) => l.value === language);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <NodeViewWrapper className="code-block">
      <div className="code-block-bar" contentEditable={false}>
        <select className="code-lang" aria-label="Code language" value={language}
          disabled={!editor.isEditable}
          onChange={(e) => updateAttributes({ language: e.target.value || null })}>
          <option value="">Auto-detect</option>
          {!known && <option value={language}>{language}</option>}
          {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <button type="button" className="code-copy" aria-label="Copy code" title="Copy code"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => navigator.clipboard.writeText(node.textContent).then(() => setCopied(true), () => {})}>
          {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
        </button>
      </div>
      <pre spellCheck={false}>
        <NodeViewContent<'code'> as="code" className={language ? `hljs language-${language}` : 'hljs'} />
      </pre>
    </NodeViewWrapper>
  );
}
