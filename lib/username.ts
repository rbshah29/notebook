/**
 * Supabase signs users in by email, so a username is stored as `<username>@<USERNAME_DOMAIN>`.
 * Accounts are created by the owner in the Supabase dashboard with that address.
 */
export const USERNAME_DOMAIN = process.env.NEXT_PUBLIC_USERNAME_DOMAIN || 'notebook.local';

/** "alice" → "alice@notebook.local"; a full email address is used as-is. */
export function toLoginEmail(usernameOrEmail: string): string {
  const value = usernameOrEmail.trim().toLowerCase();
  return value.includes('@') ? value : `${value}@${USERNAME_DOMAIN}`;
}

/** "alice@notebook.local" → "alice"; real email addresses are shown in full. */
export function displayName(email: string): string {
  const suffix = `@${USERNAME_DOMAIN}`;
  return email.toLowerCase().endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}
