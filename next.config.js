/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The dev rewrite proxy resets the backend connection after 30s by default,
  // which surfaces in the browser as a 500 "Internal Server Error" even though
  // the backend goes on to finish the request successfully. OCR-backed uploads
  // (bank statement scan, receipt OCR) routinely run longer than that.
  experimental: { proxyTimeout: 5 * 60 * 1000 },
  // Proxy /api/v1/* to the backend so browser only ever talks to this app's
  // port (3001) - NEXT_PUBLIC_API_URL should be the relative '/api/v1' for
  // this to take effect (see .env.local.example). BACKEND_URL is server-only
  // (no NEXT_PUBLIC_ prefix), read at request time, not baked into the client bundle.
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    return [{ source: '/api/v1/:path*', destination: `${backendUrl}/api/v1/:path*` }];
  },
};

module.exports = nextConfig;
