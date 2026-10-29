import BrandLogo from './BrandLogo';

// Full-screen branded loading state: shown while a session is being restored,
// right after login, and while the first route decides where to send the user.
export default function SplashLoader({ message = 'Loading' }: { message?: string }) {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-orb splash-orb-a" />
      <div className="splash-orb splash-orb-b" />
      <div className="splash-center">
        <div className="splash-logo">
          <span className="splash-ring" />
          <span className="splash-ring splash-ring-2" />
          <span className="splash-mark">
            <BrandLogo variant="mark" height={44} />
          </span>
        </div>
        <div className="splash-title gradient-text">Digital Settlement</div>
        <div className="splash-message">
          {message}
          <span className="splash-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="splash-bar">
          <span />
        </div>
      </div>
    </div>
  );
}
