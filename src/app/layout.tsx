import type { Metadata, Viewport } from 'next';
import 'katex/dist/katex.min.css';
import './globals.css';

// Every page renders per request: the CSP nonce set in src/proxy.ts can only be
// stamped onto scripts at request time, and a prerendered page would ship
// scripts the policy then blocks.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Latihan TKA SD Kelas 6',
  description:
    'Latihan Tes Kemampuan Akademik SD kelas 6 untuk Bahasa Indonesia, Matematika, dan IPAS.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#3a5bd9',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
