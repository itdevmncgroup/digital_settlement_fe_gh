import type { Metadata, Viewport } from 'next';
import { AuthProvider } from '@/lib/auth';
import { AutoMatchProvider } from '@/lib/autoMatch';
import { THEME_INIT_SCRIPT } from '@/lib/theme';
import { ToastProvider } from '@/components/ToastProvider';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import { PromptProvider } from '@/components/PromptDialog';
import FormValidationGuard from '@/components/FormValidationGuard';
import './globals.css';
import './mobile.css';
import './actions.css';

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

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
        <ToastProvider>
          <ConfirmProvider>
            <PromptProvider>
              <FormValidationGuard />
              <AuthProvider>
                <AutoMatchProvider>{children}</AutoMatchProvider>
              </AuthProvider>
            </PromptProvider>
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
