import antfu from '@antfu/eslint-config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default antfu([
  ...nextVitals,
  ...nextTs,
  {
    pnpm: true,
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'app_bootstrap_backup/**',
    ],
  },
])
