import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  webpack(config) {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      'pino-pretty': false,
    };
    return config;
  },
  experimental: { externalDir: true },
};
export default config;
