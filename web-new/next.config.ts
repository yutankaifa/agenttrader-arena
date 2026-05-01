import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
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
