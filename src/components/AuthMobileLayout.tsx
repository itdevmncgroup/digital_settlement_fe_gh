import { ReactNode } from 'react';
import BrandLogo from '@/components/BrandLogo';

// Shell for the public forgot/reset-password pages. These are opened from an
// email on a phone, so they are laid out for a mobile browser first (single
// column, full-width controls, 16px inputs so iOS doesn't zoom on focus) and
// simply stay centred and narrow on a desktop browser.
export default function AuthMobileLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="login-page auth-mobile-page">
      <div className="login-card auth-mobile-card">
        <div className="auth-mobile-logo">
          <BrandLogo height={52} />
        </div>
        <h2 className="gradient-text">{title}</h2>
        {subtitle && <p className="auth-mobile-subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
