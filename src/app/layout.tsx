import type { Metadata } from 'next';
import { AuthProvider } from '@/lib/auth';
import { AutoMatchProvider } from '@/lib/autoMatch';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Digital Settlement',
  description: 'Sales Client Entertainment & Expense Management System - Web Admin',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Sets data-theme before first paint (default light) - avoids a flash of the wrong theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>
          <AutoMatchProvider>{children}</AutoMatchProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
