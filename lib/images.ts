import { getSupabase } from '@/lib/supabase';

export const IMAGE_BUCKET = 'note-images';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];

export function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
}

/** Checks a file before uploading; returns a message for the user when it can't be used. */
export function validateImage(file: File): string | null {
  if (!TYPES.includes(file.type)) return `“${file.name}” isn’t a supported image (PNG, JPEG, GIF, WebP or AVIF).`;
  if (file.size > MAX_IMAGE_BYTES) return `“${file.name}” is larger than 10 MB.`;
  return null;
}

/**
 * Uploads to the user's folder in Supabase Storage and returns the public URL.
 * File names are random, so a URL can't be guessed from another one.
 */
export async function uploadImage(file: File): Promise<string> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You’re signed out. Sign in again to add images.');
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
  const path = `${session.user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(IMAGE_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '31536000',
  });
  if (error) {
    throw new Error(/bucket not found/i.test(error.message)
      ? 'Image storage isn’t set up yet. Run supabase/sharing-and-images.sql in your Supabase project.'
      : error.message);
  }
  return supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}
