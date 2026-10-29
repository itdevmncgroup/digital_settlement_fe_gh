// MNC Media & Entertainment logo. `full` is the wordmark + emblem (login / auth pages), `mark` is the
// emblem alone for tight spots (sidebar, top bar, splash). Both sit on a white chip because the
// wordmark is dark navy and would vanish on the dark theme / sidebar.
export default function BrandLogo({ variant = 'full', height = 40 }: { variant?: 'full' | 'mark'; height?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="brand-logo"
      src={variant === 'full' ? '/logo.png' : '/logo-mark.png'}
      alt="MNC Media & Entertainment"
      style={{ height }}
    />
  );
}
