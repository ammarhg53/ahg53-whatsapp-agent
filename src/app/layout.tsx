import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AHG53 WhatsApp',
  description: 'AHG53 Agency WhatsApp assistant — Ideas to Digital Reality',
  robots: { index: false, follow: false }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
