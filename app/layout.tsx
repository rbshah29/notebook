import type { Metadata, Viewport } from 'next';
import { themeScript } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Notebook',
  description: 'My personal editor',
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#141415' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by themeScript before hydration, so the attribute legitimately differs.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
