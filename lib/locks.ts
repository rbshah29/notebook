import type { JSONContent } from '@tiptap/react';
import { getSupabase } from '@/lib/supabase';
import type { Note } from '@/lib/notes';

/** What the lock functions in supabase/note-locks.sql return. */
export type LockResult =
  | { ok: true; content?: Note['content'] }
  | { ok: false; error: 'wrong_pin'; remaining: number }
  | { ok: false; error: 'too_many_attempts'; retry_after: number }
  | { ok: false; error: 'invalid_pin' | 'not_found' | 'not_locked' | 'already_locked' | 'request_failed'; message?: string };

export const isPin = (pin: string) => /^\d{4}$/.test(pin);

async function call(fn: string, args: Record<string, unknown>): Promise<LockResult> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) {
    // PGRST202: the function doesn't exist, i.e. note-locks.sql hasn't been run.
    const message = error.code === 'PGRST202'
      ? 'Note locks aren’t set up yet. Run supabase/note-locks.sql in your Supabase project.'
      : error.message;
    return { ok: false, error: 'request_failed', message };
  }
  return data as LockResult;
}

const asJson = (content: Note['content']): JSONContent | null =>
  content && typeof content === 'object' ? content : null;

export const lockNote = (id: string, pin: string, content: Note['content']) =>
  call('lock_note', { nid: id, pin, body: asJson(content) });

export const unlockNote = (id: string, pin: string) => call('unlock_note', { nid: id, pin });

export const saveLockedNote = (id: string, pin: string, content: Note['content']) =>
  call('save_locked_note', { nid: id, pin, body: asJson(content) });

export const removeNoteLock = (id: string, pin: string) => call('remove_note_lock', { nid: id, pin });

export const deleteLockedNote = (id: string, pin: string) => call('delete_locked_note', { nid: id, pin });

/** A message for the user, or null when the call succeeded. */
export function lockErrorMessage(r: LockResult): string | null {
  if (r.ok) return null;
  switch (r.error) {
    case 'wrong_pin':
      return r.remaining > 0
        ? `Wrong PIN. ${r.remaining} ${r.remaining === 1 ? 'try' : 'tries'} left before a 15-minute wait.`
        : 'Wrong PIN.';
    case 'too_many_attempts': {
      const minutes = Math.ceil(r.retry_after / 60);
      return `Too many wrong PINs. Try again in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
    }
    case 'invalid_pin': return 'The PIN must be exactly 4 digits.';
    case 'not_found': return 'This note no longer exists.';
    case 'not_locked': return 'This note isn’t locked.';
    case 'already_locked': return 'This note is already locked.';
    default: return r.message ?? 'Something went wrong. Try again.';
  }
}
