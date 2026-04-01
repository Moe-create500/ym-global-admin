import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'YM Global Enterprise Ventures',
  description: 'CFO Dashboard — Multi-Store P&L Management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
