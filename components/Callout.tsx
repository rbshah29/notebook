'use client';
import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { Info, Lightbulb, TriangleAlert, OctagonAlert, Check } from 'lucide-react';

export const CALLOUTS = {
  info: { label: 'Info', icon: Info },
  tip: { label: 'Tip', icon: Lightbulb },
  warning: { label: 'Warning', icon: TriangleAlert },
  danger: { label: 'Danger', icon: OctagonAlert },
} as const;

export type CalloutVariant = keyof typeof CALLOUTS;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (variant?: CalloutVariant) => ReturnType;
      toggleCallout: (variant?: CalloutVariant) => ReturnType;
    };
  }
}

/** A coloured box with an icon (info, tip, warning, danger) that can hold any blocks. */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el) => {
          const v = el.getAttribute('data-callout') ?? '';
          return v in CALLOUTS ? v : 'info';
        },
        renderHTML: (attrs) => ({ 'data-callout': attrs.variant }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { class: 'callout' }), 0];
  },

  addCommands() {
    return {
      setCallout: (variant = 'info') => ({ commands }) => commands.wrapIn(this.name, { variant }),
      toggleCallout: (variant = 'info') => ({ commands }) => commands.toggleWrap(this.name, { variant }),
    };
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at the start of an empty callout unwraps it instead of deleting the box.
      Backspace: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parentOffset !== 0) return false;
        const box = $from.node(-1);
        if (box?.type.name !== this.name || $from.index(-1) !== 0 || $from.parent.content.size) return false;
        return editor.commands.lift(this.name);
      },
      // Enter on an empty last line leaves the callout, like lists do.
      Enter: ({ editor }) => {
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.type.name !== 'paragraph' || $from.parent.content.size) return false;
        const box = $from.node(-1);
        if (box?.type.name !== this.name || box.childCount < 2 || $from.index(-1) !== box.childCount - 1) return false;
        return editor.commands.lift(this.name);
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const variant = (node.attrs.variant as CalloutVariant) in CALLOUTS ? node.attrs.variant as CalloutVariant : 'info';
  const { icon: Icon, label } = CALLOUTS[variant];
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!wrapRef.current?.contains(e.target as globalThis.Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <NodeViewWrapper className="callout" data-callout={variant}>
      <div className="callout-icon menu-wrap" contentEditable={false} ref={wrapRef}>
        {editor.isEditable ? (
          <button type="button" className="callout-btn" aria-label={`${label} callout. Change type`}
            aria-expanded={open} title="Change type"
            onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen((o) => !o)}>
            <Icon size={18} />
          </button>
        ) : (
          <span className="callout-btn" role="img" aria-label={label}><Icon size={18} /></span>
        )}
        {open && (
          <div className="menu menu-start menu-bottom" role="menu">
            {(Object.keys(CALLOUTS) as CalloutVariant[]).map((v) => {
              const { icon: VIcon, label: vLabel } = CALLOUTS[v];
              return (
                <button key={v} type="button" role="menuitemradio" aria-checked={v === variant}
                  className="menu-item" data-callout-option={v}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { updateAttributes({ variant: v }); setOpen(false); }}>
                  <span className="menu-icon"><VIcon size={15} /></span>
                  <span className="menu-label">{vLabel}</span>
                  {v === variant && <span className="menu-check"><Check size={14} /></span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <NodeViewContent className="callout-content" />
    </NodeViewWrapper>
  );
}
