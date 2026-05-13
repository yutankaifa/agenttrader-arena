import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type CanonicalEndpoint = {
  label: string;
  method: 'GET' | 'POST';
  path: string;
};

const testFile = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(testFile), '..');
const repoRoot = path.resolve(appRoot, '..', '..');

const canonicalAgentEndpoints: CanonicalEndpoint[] = [
  {
    label: 'register',
    method: 'POST',
    path: '/api/openclaw/agents/register',
  },
  {
    label: 'profile initialization / update',
    method: 'POST',
    path: '/api/openclaw/agents/init-profile',
  },
  {
    label: 'status / claim check',
    method: 'GET',
    path: '/api/agent/me',
  },
  {
    label: 'connectivity check',
    method: 'POST',
    path: '/api/openclaw/agents/heartbeat-ping',
  },
  {
    label: 'briefing',
    method: 'GET',
    path: '/api/agent/briefing',
  },
  {
    label: 'detail request',
    method: 'POST',
    path: '/api/agent/detail-request',
  },
  {
    label: 'decisions',
    method: 'POST',
    path: '/api/agent/decisions',
  },
  {
    label: 'error report',
    method: 'POST',
    path: '/api/agent/error-report',
  },
  {
    label: 'daily summary',
    method: 'POST',
    path: '/api/agent/daily-summary-update',
  },
];

let passed = 0;
let failed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function endpointKey(endpoint: Pick<CanonicalEndpoint, 'method' | 'path'>) {
  return `${endpoint.method} ${endpoint.path}`;
}

function parseMarkdownEndpoints(content: string) {
  const endpoints = new Map<string, CanonicalEndpoint>();
  const labeledEndpointPattern =
    /^\s*-\s+([^:\n]+):\s+`(GET|POST)\s+\{\{APP_URL\}\}([^`]+)`/gm;
  const unlabeledEndpointPattern =
    /^\s*-\s+`(GET|POST)\s+\{\{APP_URL\}\}([^`]+)`/gm;

  for (const match of content.matchAll(labeledEndpointPattern)) {
    const endpoint: CanonicalEndpoint = {
      label: match[1].trim(),
      method: match[2] as CanonicalEndpoint['method'],
      path: match[3].trim(),
    };
    endpoints.set(endpointKey(endpoint), endpoint);
  }

  for (const match of content.matchAll(unlabeledEndpointPattern)) {
    const endpoint: CanonicalEndpoint = {
      label: endpointKey({
        method: match[1] as CanonicalEndpoint['method'],
        path: match[2].trim(),
      }),
      method: match[1] as CanonicalEndpoint['method'],
      path: match[2].trim(),
    };
    endpoints.set(endpointKey(endpoint), endpoint);
  }

  return endpoints;
}

function routeFileFor(endpoint: CanonicalEndpoint) {
  const routeSegments = endpoint.path
    .replace(/^\/api\//, '')
    .split('/');

  return path.join(appRoot, 'src', 'app', 'api', ...routeSegments, 'route.ts');
}

const endpointsMarkdown = readRepoFile(
  'apps/web-new/AgentTrader_skill/endpoints.md'
);
const integrationMarkdown = readRepoFile(
  'apps/web-new/AgentTrader_skill/integration.md'
);
const schemasMarkdown = readRepoFile(
  'apps/web-new/AgentTrader_skill/schemas.md'
);
const agentRespSource = readRepoFile('apps/web-new/src/lib/agent-resp.ts');
const sharedTypesSource = readRepoFile('packages/agenttrader-types/index.d.ts');

await runTest('endpoint index lists every canonical agent runtime endpoint', () => {
  const documentedEndpoints = parseMarkdownEndpoints(endpointsMarkdown);

  for (const endpoint of canonicalAgentEndpoints) {
    assert.ok(
      documentedEndpoints.has(endpointKey(endpoint)),
      `Missing ${endpointKey(endpoint)} in endpoints.md`
    );
  }
});

await runTest('integration guide repeats the canonical agent runtime endpoints', () => {
  const documentedEndpoints = parseMarkdownEndpoints(integrationMarkdown);

  for (const endpoint of canonicalAgentEndpoints) {
    assert.ok(
      documentedEndpoints.has(endpointKey(endpoint)),
      `Missing ${endpointKey(endpoint)} in integration.md`
    );
  }
});

await runTest('schema index references the canonical agent runtime endpoints', () => {
  for (const endpoint of canonicalAgentEndpoints) {
    assert.match(
      schemasMarkdown,
      new RegExp(
        `Current endpoint: \`${endpoint.method} \\{\\{APP_URL\\}\\}${endpoint.path.replaceAll('/', '\\/')}\``
      ),
      `Missing schema index entry for ${endpointKey(endpoint)}`
    );
  }
});

await runTest('canonical agent endpoints have matching Next route handlers', () => {
  for (const endpoint of canonicalAgentEndpoints) {
    const routeFile = routeFileFor(endpoint);

    assert.ok(
      existsSync(routeFile),
      `Missing route file for ${endpointKey(endpoint)} at ${routeFile}`
    );

    const routeSource = readFileSync(routeFile, 'utf8');
    assert.match(
      routeSource,
      new RegExp(`export\\s+async\\s+function\\s+${endpoint.method}\\b`),
      `Route ${routeFile} does not export ${endpoint.method}`
    );
  }
});

await runTest('agent response helpers preserve the unified API envelope', () => {
  assert.match(agentRespSource, /success:\s*true/);
  assert.match(agentRespSource, /success:\s*false/);
  assert.match(agentRespSource, /error:\s*body/);
  assert.match(agentRespSource, /code,/);
  assert.match(agentRespSource, /message,/);
  assert.match(agentRespSource, /recoverable:/);
  assert.match(agentRespSource, /retry_allowed:/);
});

await runTest('shared types expose the documented API error envelope fields', () => {
  assert.match(sharedTypesSource, /export type AgentApiErrorBody = \{/);
  assert.match(sharedTypesSource, /code: string;/);
  assert.match(sharedTypesSource, /message: string;/);
  assert.match(sharedTypesSource, /recoverable: boolean;/);
  assert.match(sharedTypesSource, /retry_allowed: boolean;/);
  assert.match(sharedTypesSource, /retry_after_seconds\?: number;/);
  assert.match(sharedTypesSource, /details\?: Record<string, unknown>;/);
});

console.log(`\n${passed} contract checks passed, ${failed} failed`);

if (failed > 0) {
  process.exitCode = 1;
}
