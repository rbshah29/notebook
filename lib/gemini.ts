'use client';
import { useSyncExternalStore } from 'react';
import type { Editor, JSONContent } from '@tiptap/core';
import { getSettings } from '@/lib/settings';
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';

export const ALLOWED_AI_EMAIL = 'rbshah0029@gmail.com';

let currentAllowed = false;
let authSubscribed = false;
const authListeners = new Set<() => void>();

function ensureAuthSubscription() {
  if (authSubscribed || typeof window === 'undefined' || !isSupabaseConfigured) return;
  authSubscribed = true;
  const supabase = getSupabase();
  supabase.auth.getSession().then(({ data }) => {
    const email = data.session?.user?.email?.trim().toLowerCase();
    const next = email === ALLOWED_AI_EMAIL;
    if (next !== currentAllowed) {
      currentAllowed = next;
      authListeners.forEach((l) => l());
    }
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    const email = session?.user?.email?.trim().toLowerCase();
    const next = email === ALLOWED_AI_EMAIL;
    if (next !== currentAllowed) {
      currentAllowed = next;
      authListeners.forEach((l) => l());
    }
  });
}

function subscribeAiAllowed(listener: () => void) {
  ensureAuthSubscription();
  authListeners.add(listener);
  return () => { authListeners.delete(listener); };
}

/** True only when the signed-in user is rbshah0029@gmail.com. Safe to call outside React. */
export function isAiAllowed(): boolean {
  ensureAuthSubscription();
  return currentAllowed;
}

/** React hook that returns true only when the signed-in user is rbshah0029@gmail.com. */
export function useAiAllowed(): boolean {
  return useSyncExternalStore(subscribeAiAllowed, isAiAllowed, () => false);
}

export type AiActionKind =
  | 'ask'
  | 'continue'
  | 'summarize'
  | 'improve'
  | 'fix'
  | 'shorter'
  | 'longer';

const SYSTEM_INSTRUCTION =
  'You are a concise, helpful writing and coding assistant embedded inside a Markdown/rich-text notebook editor. ' +
  'Return only the requested content in clean Markdown without conversational filler, preambles, or surrounding quotes.';

export async function askGemini({
  prompt,
  context,
  instruction = SYSTEM_INSTRUCTION,
}: {
  prompt: string;
  context?: string;
  instruction?: string;
}): Promise<string> {
  const { geminiModel, geminiApiKey } = getSettings();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (geminiApiKey.trim()) {
    headers['x-gemini-key'] = geminiApiKey.trim();
  }
  if (isSupabaseConfigured) {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch('/api/gemini', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt,
      context,
      instruction,
      model: geminiModel || 'gemini-3.8-flash',
    }),
  });

  const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Gemini request failed (${res.status})`);
  }
  return (data.text ?? '').trim();
}

/** Parses inline Markdown (**bold**, *italic*, `code`, ~~strike~~, [link](url)) into Tiptap text nodes. */
function parseInline(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|~~([^~]+)~~|\[([^\]]+)\]\(([^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    if (match[2] !== undefined) {
      nodes.push({ type: 'text', text: match[2], marks: [{ type: 'bold' }] });
    } else if (match[3] !== undefined) {
      nodes.push({ type: 'text', text: match[3], marks: [{ type: 'italic' }] });
    } else if (match[4] !== undefined) {
      nodes.push({ type: 'text', text: match[4], marks: [{ type: 'code' }] });
    } else if (match[5] !== undefined) {
      nodes.push({ type: 'text', text: match[5], marks: [{ type: 'strike' }] });
    } else if (match[6] !== undefined && match[7] !== undefined) {
      nodes.push({
        type: 'text',
        text: match[6],
        marks: [{ type: 'link', attrs: { href: match[7] } }],
      });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', text: text.slice(lastIndex) });
  }
  return nodes;
}

/** Converts Markdown text from Gemini into Tiptap block nodes. */
export function markdownToNodes(markdown: string): JSONContent[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: JSONContent[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // Fenced code block
    const fenceMatch = /^```(\w*)\s*$/.exec(line.trim());
    if (fenceMatch) {
      const language = fenceMatch[1] || null;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // skip closing fence
      const code = codeLines.join('\n');
      blocks.push({
        type: 'codeBlock',
        attrs: { language },
        content: code ? [{ type: 'text', text: code }] : [],
      });
      continue;
    }

    // Horizontal rule
    if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) {
      blocks.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // Heading
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        attrs: { level: headingMatch[1].length as 1 | 2 | 3 },
        content: parseInline(headingMatch[2].trim()),
      });
      i++;
      continue;
    }

    // Task list
    if (/^\s*[-*]\s+\[([ xX])\]\s+/.test(line)) {
      const items: JSONContent[] = [];
      while (i < lines.length) {
        const m = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        items.push({
          type: 'taskItem',
          attrs: { checked: m[1].toLowerCase() === 'x' },
          content: [{ type: 'paragraph', content: parseInline(m[2].trim()) }],
        });
        i++;
      }
      blocks.push({ type: 'taskList', content: items });
      continue;
    }

    // Bullet list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: JSONContent[] = [];
      while (i < lines.length) {
        const m = /^\s*[-*]\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(m[1].trim()) }],
        });
        i++;
      }
      blocks.push({ type: 'bulletList', content: items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: JSONContent[] = [];
      while (i < lines.length) {
        const m = /^\s*\d+\.\s+(.+)$/.exec(lines[i]);
        if (!m) break;
        items.push({
          type: 'listItem',
          content: [{ type: 'paragraph', content: parseInline(m[1].trim()) }],
        });
        i++;
      }
      blocks.push({ type: 'orderedList', content: items });
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({
        type: 'blockquote',
        content: [{ type: 'paragraph', content: parseInline(quoteLines.join(' ').trim()) }],
      });
      continue;
    }

    // Paragraph (join consecutive plain lines)
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s|```|(---|\*\*\*|___)\s*$|\s*[-*]\s|\s*\d+\.\s|^>\s?)/.test(lines[i])
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length) {
      blocks.push({
        type: 'paragraph',
        content: parseInline(paraLines.join(' ')),
      });
    } else {
      i++;
    }
  }

  return blocks;
}

/** Dispatches a custom event on the editor DOM to open the inline AI prompt bar. */
export function openEditorAiPrompt(editor: Editor) {
  editor.view.dom.dispatchEvent(new CustomEvent('notebook:ai-prompt', { bubbles: true }));
}

export type AiStatusDetail = { busy: boolean; label?: string; error?: string };

function emitStatus(editor: Editor, detail: AiStatusDetail) {
  editor.view.dom.dispatchEvent(new CustomEvent<AiStatusDetail>('notebook:ai-status', { bubbles: true, detail }));
}

/** Runs an AI action against the current editor selection or note content and inserts the result. */
export async function runEditorAi(
  editor: Editor,
  kind: AiActionKind,
  customPrompt?: string,
): Promise<void> {
  const { from, to, empty } = editor.state.selection;
  const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, '\n\n').trim();
  const fullText = editor.getText().trim();
  const beforeCursor = editor.state.doc.textBetween(0, from, '\n\n').trim();

  let prompt = '';
  let context = '';
  let replaceSelection = false;
  let wrapInCallout = false;
  let statusLabel = 'Thinking…';

  switch (kind) {
    case 'ask': {
      prompt = (customPrompt ?? '').trim();
      if (!prompt) return;
      context = selectedText || fullText;
      replaceSelection = !empty && /^(rewrite|translate|fix|replace|convert|shorten|expand|improve)/i.test(prompt);
      statusLabel = 'Asking Gemini…';
      break;
    }
    case 'continue': {
      context = beforeCursor || fullText;
      if (!context) {
        prompt = 'Write an engaging opening paragraph for a new note.';
      } else {
        prompt = 'Continue writing seamlessly from where the context ends. Keep the same tone, style, and formatting.';
      }
      statusLabel = 'Continuing writing…';
      break;
    }
    case 'summarize': {
      context = selectedText || fullText;
      if (!context) {
        emitStatus(editor, { busy: false, error: 'Write some content in the note first to summarize it.' });
        return;
      }
      prompt = 'Summarize the key points concisely using bullet points.';
      wrapInCallout = empty;
      statusLabel = 'Summarizing…';
      break;
    }
    case 'improve': {
      context = selectedText || fullText;
      if (!context) {
        emitStatus(editor, { busy: false, error: 'Select text or write something first to improve it.' });
        return;
      }
      prompt = 'Improve the clarity, flow, and readability of this text while preserving its meaning.';
      replaceSelection = !empty;
      statusLabel = 'Improving writing…';
      break;
    }
    case 'fix': {
      context = selectedText || fullText;
      if (!context) {
        emitStatus(editor, { busy: false, error: 'Select text or write something first to fix grammar.' });
        return;
      }
      prompt = 'Fix any spelling, grammar, and punctuation mistakes in this text without changing its tone.';
      replaceSelection = !empty;
      statusLabel = 'Fixing grammar…';
      break;
    }
    case 'shorter': {
      context = selectedText || fullText;
      if (!context) {
        emitStatus(editor, { busy: false, error: 'Select text first to make it shorter.' });
        return;
      }
      prompt = 'Rewrite this text to be significantly more concise while keeping the essential meaning.';
      replaceSelection = !empty;
      statusLabel = 'Making shorter…';
      break;
    }
    case 'longer': {
      context = selectedText || fullText;
      if (!context) {
        emitStatus(editor, { busy: false, error: 'Select text first to expand it.' });
        return;
      }
      prompt = 'Expand on this text with more helpful detail, examples, and depth.';
      replaceSelection = !empty;
      statusLabel = 'Expanding…';
      break;
    }
  }

  emitStatus(editor, { busy: true, label: statusLabel });
  try {
    const result = await askGemini({ prompt, context });
    if (!result) {
      emitStatus(editor, { busy: false, error: 'Gemini returned an empty response.' });
      return;
    }

    const nodes = markdownToNodes(result);
    if (!nodes.length) {
      emitStatus(editor, { busy: false });
      return;
    }

    if (wrapInCallout) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'callout',
          attrs: { variant: 'info' },
          content: nodes,
        })
        .run();
    } else if (replaceSelection && !empty) {
      // If replacing a single inline selection with a single paragraph, insert inline content.
      if (nodes.length === 1 && nodes[0].type === 'paragraph' && nodes[0].content) {
        editor.chain().focus().insertContentAt({ from, to }, nodes[0].content).run();
      } else {
        editor.chain().focus().insertContentAt({ from, to }, nodes).run();
      }
    } else if (!empty) {
      editor.chain().focus().insertContentAt(to, nodes).run();
    } else {
      editor.chain().focus().insertContent(nodes).run();
    }

    emitStatus(editor, { busy: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Gemini request failed';
    emitStatus(editor, { busy: false, error: message });
  }
}
