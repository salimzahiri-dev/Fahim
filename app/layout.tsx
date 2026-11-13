import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fahim',
  description: 'Tuteur de physique pour la 1re bac sciences maths : tu paries, tu testes, puis tu comprends.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f6e8c',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-dvh bg-paper text-ink">{children}</body>
    </html>
  );
}
