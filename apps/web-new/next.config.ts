import { join } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['agenttrader-types'],
  turbopack: {
    root: join(process.cwd(), '../..'),
  },
  async rewrites() {
    return [
      {
        source: '/skill',
        destination: '/api/skill',
      },
      {
        source: '/skill.md',
        destination: '/api/skill',
      },
      {
        source: '/skill/:slug',
        destination: '/api/skill/:slug',
      },
    ];
  },
};

export default nextConfig;
