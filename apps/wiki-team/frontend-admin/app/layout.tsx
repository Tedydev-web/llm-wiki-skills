/**
 * layout.tsx — root app layout.
 * Mounts toast container and provides session context.
 */

import type { Metadata } from 'next';
import './globals.css';
import { ToastContainer } from '@/components/ui/toast-container';

export const metadata: Metadata = {
  title: 'Wiki Admin',
  description: 'Team workspace administration',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
        <ToastContainer />
      </body>
    </html>
  );
}
