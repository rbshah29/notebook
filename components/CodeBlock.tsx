'use client';
import { useEffect, useState } from 'react';
import {
  NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type Editor, type ReactNodeViewProps,
} from '@tiptap/react';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode, NodeType } from '@tiptap/pm/model';
import { Check, Copy, ListOrdered, WrapText, Braces } from 'lucide-react';
import { lowlight, LANGUAGES, indentUnit, resolveLanguage, dedent, detectCode, formatCode } from '@/lib/code';
import { getSettings, useSettings } from '@/lib/settings';

const OPENERS: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
const lineNumbersKey = new PluginKey('codeLineNumbers');

/** Per-block override, falling back to the setting. */
const showLineNumbers = (node: PMNode) => (node.attrs.lineNumbers as boolean | null) ?? getSettings().lineNumbers;

/** Re-reads settings-driven defaults (line numbers) after the settings change. */
export function refreshCodeBlocks(editor: Editor) {
  if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(lineNumbersKey, true));
}

function lineNumberDecorations(doc: PMNode, type: NodeType) {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type !== type) return true;
    if (showLineNumbers(node)) {
      const text = node.textContent;
      const start = pos + 1;
      let line = 1;
      const add = (at: number, n: number) => decorations.push(Decoration.widget(at, () => {
        const el = document.createElement('span');
        el.className = 'code-ln';
        el.textContent = String(n);
        el.contentEditable = 'false';
        return el;
      }, { side: -1, key: `ln-${n}`, ignoreSelection: true }));
      add(start, line);
      for (let i = 0; i < text.length; i++) if (text[i] === '\n') add(start + i + 1, ++line);
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** Start offsets (within the block's text) of every line the selection touches. */
function selectedLines(state: EditorState, type: NodeType) {
  const { $from, $to, from, to } = state.selection;
  if ($from.parent.type !== type || !$from.sameParent($to)) return null;
  const text = $from.parent.textContent;
  const start = $from.start();
  const a = from - start;
  const b = to - start;
  const lines = [text.lastIndexOf('\n', a - 1) + 1];
  // A selection ending at the very start of a line doesn't include that line (as in VS Code).
  for (let i = a; i < b; i++) if (text[i] === '\n' && i + 1 < b) lines.push(i + 1);
  return { text, start, lines };
}

/**
 * Code block with VS Code–style syntax colors, a language picker, optional line numbers and
 * word wrap, Tab / Shift+Tab indentation, Enter that keeps (and after `{`, `:`… adds)
 * indentation, and pastes that arrive as code.
 */
export const CodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    const flag = (name: 'lineNumbers' | 'wrap', data: string) => ({
      default: null,
      parseHTML: (el: HTMLElement) => (el.dataset[name] ? el.dataset[name] === 'true' : null),
      renderHTML: (attrs: Record<string, unknown>) => (attrs[name] == null ? {} : { [data]: String(attrs[name]) }),
    });
    return {
      ...this.parent?.(),
      lineNumbers: flag('lineNumbers', 'data-line-numbers'),
      wrap: flag('wrap', 'data-wrap'),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },

  addKeyboardShortcuts() {
    const parent = this.parent?.() ?? {};
    return {
      ...parent,
      'Mod-`': () => this.editor.commands.toggleCodeBlock(),
      // Select just the code instead of the whole note.
      'Mod-a': ({ editor }) => {
        const { $from } = editor.state.selection;
        if ($from.parent.type !== this.type) return false;
        return editor.commands.setTextSelection({ from: $from.start(), to: $from.end() });
      },
      Tab: ({ editor }) => {
        const sel = selectedLines(editor.state, this.type);
        if (!sel) return false;
        const unit = indentUnit();
        const { from, to } = editor.state.selection;
        return editor.commands.command(({ tr }) => {
          if (from === to) {
            tr.insertText(unit, from);
            return true;
          }
          [...sel.lines].reverse().forEach((l) => tr.insertText(unit, sel.start + l));
          // Keep whole lines selected when the selection started at a line start, as VS Code does.
          const anchor = from === sel.start + sel.lines[0] ? from : tr.mapping.map(from);
          tr.setSelection(TextSelection.create(tr.doc, anchor, tr.mapping.map(to)));
          return true;
        });
      },
      'Shift-Tab': ({ editor }) => {
        const sel = selectedLines(editor.state, this.type);
        if (!sel) return false;
        const unit = indentUnit().length;
        return editor.commands.command(({ tr }) => {
          [...sel.lines].reverse().forEach((l) => {
            const lead = /^[ \t]*/.exec(sel.text.slice(l))![0];
            const n = lead.startsWith('\t') ? 1 : Math.min(lead.length, unit);
            if (n) tr.delete(sel.start + l, sel.start + l + n);
          });
          return true;
        });
      },
      // Inside leading spaces, Backspace removes one indent level at a time.
      Backspace: (props) => {
        const { $from, empty } = props.editor.state.selection;
        if (empty && $from.parent.type === this.type) {
          const text = $from.parent.textContent;
          const offset = $from.parentOffset;
          const before = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
          if (before.length && !before.trim() && !before.includes('\t')) {
            const unit = indentUnit().length;
            const n = before.length % unit || unit;
            return props.editor.commands.deleteRange({ from: $from.pos - n, to: $from.pos });
          }
        }
        return parent.Backspace?.(props) ?? false;
      },
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
        const deeper = last in OPENERS || last === ':' ? indent + indentUnit() : indent;
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
    const lineNumbers = new Plugin<DecorationSet>({
      key: lineNumbersKey,
      state: {
        init: (_, state) => lineNumberDecorations(state.doc, type),
        apply: (tr, old) => (tr.docChanged || tr.getMeta(lineNumbersKey)
          ? lineNumberDecorations(tr.doc, type)
          : old),
      },
      props: { decorations: (state) => lineNumbersKey.getState(state) },
    });
    return [paste, lineNumbers, ...(this.parent?.() ?? [])];
  },
}).configure({
  lowlight,
  enableTabIndentation: false, // handled above, using the tab-size setting
  exitOnTripleEnter: false,
});

function CodeBlockView({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const settings = useSettings();
  const [flash, setFlash] = useState<'copied' | 'invalid' | null>(null);
  const language = (node.attrs.language as string | null) ?? '';
  const known = !language || LANGUAGES.some((l) => l.value === language);
  const editable = editor.isEditable;
  const lineNumbers = (node.attrs.lineNumbers as boolean | null) ?? settings.lineNumbers;
  const wrap = (node.attrs.wrap as boolean | null) ?? settings.wordWrap;
  const lineCount = node.textContent.split('\n').length;

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  function format() {
    const pos = getPos();
    const formatted = formatCode(language, node.textContent, settings.tabSize);
    if (formatted === null || typeof pos !== 'number') return setFlash('invalid');
    if (formatted === node.textContent) return;
    editor.chain().command(({ tr, state }) => {
      tr.replaceWith(pos + 1, pos + node.nodeSize - 1, state.schema.text(formatted));
      return true;
    }).run();
  }

  const label = LANGUAGES.find((l) => l.value === language)?.label ?? (language || 'Code');

  return (
    <NodeViewWrapper className="code-block">
      <div className="code-block-bar" contentEditable={false}>
        {editable ? (
          <select className="code-lang" aria-label="Code language" value={language}
            onChange={(e) => updateAttributes({ language: e.target.value || null })}>
            <option value="">Auto-detect</option>
            {!known && <option value={language}>{language}</option>}
            {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        ) : (
          <span className="code-lang static">{label}</span>
        )}
        <div className="code-actions">
          {editable && (
            <>
              {formatCode.supports(language) && (
                <button type="button" className="code-action" title="Format JSON"
                  onMouseDown={(e) => e.preventDefault()} onClick={format}>
                  <Braces size={13} /> {flash === 'invalid' ? 'Invalid JSON' : 'Format'}
                </button>
              )}
              <button type="button" className={`code-action${wrap ? ' on' : ''}`} aria-pressed={wrap}
                aria-label="Word wrap" title="Word wrap"
                onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ wrap: !wrap })}>
                <WrapText size={13} />
              </button>
              <button type="button" className={`code-action${lineNumbers ? ' on' : ''}`} aria-pressed={lineNumbers}
                aria-label="Line numbers" title="Line numbers"
                onMouseDown={(e) => e.preventDefault()} onClick={() => updateAttributes({ lineNumbers: !lineNumbers })}>
                <ListOrdered size={13} />
              </button>
            </>
          )}
          <button type="button" className="code-action" aria-label="Copy code" title="Copy code"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => navigator.clipboard.writeText(node.textContent).then(() => setFlash('copied'), () => {})}>
            {flash === 'copied' ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
          </button>
        </div>
      </div>
      <pre spellCheck={false} className={`${wrap ? 'wrap' : ''}${lineNumbers ? ' with-ln' : ''}`}
        style={{ '--ln-width': `${String(lineCount).length}ch` } as React.CSSProperties}>
        <NodeViewContent<'code'> as="code" className={language ? `hljs language-${language}` : 'hljs'} />
      </pre>
    </NodeViewWrapper>
  );
}
