import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@sw/ui', '@sw/shared', '@sw/forge-kit', '@sw/pricing'],
  env: {
    NEXT_PUBLIC_FORGE_RUNTIME_ORIGIN: process.env.FORGE_RUNTIME_ORIGIN ?? 'http://localhost:3002',
  },
  // The browser talks to the API same-origin through /api (cookies stay first-party).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/:path*` }];
  },
};

export default config;
