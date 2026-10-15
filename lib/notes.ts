import type { JSONContent } from '@tiptap/react';
import { getSupabase } from '@/lib/supabase';

export type Note = {
  id: string;
  title: string;
  content: JSONContent | string | null;
  updated_at: string;
};

export type NotePatch = Partial<Pick<Note, 'title' | 'content' | 'updated_at'>>;

/** Id of the in-memory scratchpad. It is never written to Supabase and is gone on refresh. */
export const SCRATCH_ID = 'scratchpad';

const COLUMNS = 'id, title, content, updated_at';

export async function fetchNotes() {
  return getSupabase().from('documents').select(COLUMNS).order('updated_at', { ascending: false })
    .overrideTypes<Note[], { merge: false }>();
}

export async function createNote(fields: Pick<Note, 'title' | 'content'> = { title: '', content: null }) {
  return getSupabase().from('documents').insert(fields).select(COLUMNS).single()
    .overrideTypes<Note, { merge: false }>();
}

export async function updateNote(id: string, patch: NotePatch) {
  return getSupabase().from('documents').update(patch).eq('id', id);
}

export async function deleteNote(id: string) {
  return getSupabase().from('documents').delete().eq('id', id);
}

const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock']);

/** Flattens Tiptap JSON into plain text, separating blocks with newlines. */
export function toPlainText(content: Note['content']): string {
  if (!content) return '';
  if (typeof content === 'string') return content.replace(/<[^>]+>/g, ' ');
  const out: string[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === 'text') out.push(node.text ?? '');
    else if (node.type === 'hardBreak') out.push('\n');
    node.content?.forEach(walk);
    if (TEXT_BLOCKS.has(node.type ?? '')) out.push('\n');
  };
  walk(content);
  return out.join('').replace(/\n{2,}/g, '\n').trim();
}

const DAY = 86_400_000;

/** Compact timestamp for lists: "Just now", "5m ago", "Yesterday", "Mar 4". */
export function formatRelative(iso: string, now = Date.now()): string {
  const date = new Date(iso);
  const diff = now - date.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (date.getTime() >= startOfToday) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (date.getTime() >= startOfToday - DAY) return 'Yesterday';
  if (diff < 6 * DAY) return date.toLocaleDateString(undefined, { weekday: 'long' });
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatFull(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium', timeStyle: 'short',
  });
}
