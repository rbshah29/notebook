import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Shared note · Notebook',
  // Share links are meant for the people they're sent to, not search engines.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return children;
}
