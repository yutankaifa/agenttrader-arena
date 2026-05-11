import { Agent as HttpsAgent } from 'node:https';
import { connect as netConnect, Socket } from 'node:net';
import { connect as tlsConnect, type ConnectionOptions as TlsConnectionOptions } from 'node:tls';

type AgentCallback = (err: Error | null, socket?: Socket) => void;

function readProxyEnv(name: string): string | undefined {
  return process.env[name] || process.env[name.toLowerCase()] || undefined;
}

function resolveProxyUrl(targetUrl: string): URL | null {
  const target = new URL(targetUrl);
  const secureProxy = readProxyEnv('HTTPS_PROXY');
  const plainProxy = readProxyEnv('HTTP_PROXY');
  const fallbackProxy = readProxyEnv('ALL_PROXY');

  const rawProxy =
    target.protocol === 'wss:'
      ? secureProxy || plainProxy || fallbackProxy
      : plainProxy || secureProxy || fallbackProxy;

  if (!rawProxy) {
    return null;
  }

  return new URL(rawProxy);
}

function buildProxyAuthorization(proxyUrl: URL): string | null {
  if (!proxyUrl.username && !proxyUrl.password) {
    return null;
  }

  const username = decodeURIComponent(proxyUrl.username);
  const password = decodeURIComponent(proxyUrl.password);
  return Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
}

function createProxyTunnelError(message: string): Error {
  return new Error(`[ws-proxy] ${message}`);
}

class HttpConnectTunnelAgent extends HttpsAgent {
  constructor(private readonly proxyUrl: URL) {
    super({ keepAlive: true });
  }

  override createConnection(options: any, callback: AgentCallback): Socket {
    const proxyPort = Number(
      this.proxyUrl.port || (this.proxyUrl.protocol === 'https:' ? '443' : '80')
    );
    const targetHost = options.host || options.hostname;
    const targetPort = Number(options.port || 443);

    if (!targetHost) {
      callback(createProxyTunnelError('Missing websocket target host'));
      return new Socket();
    }

    const proxySocket =
      this.proxyUrl.protocol === 'https:'
        ? tlsConnect({
            host: this.proxyUrl.hostname,
            port: proxyPort,
            servername: this.proxyUrl.hostname,
          })
        : netConnect({
            host: this.proxyUrl.hostname,
            port: proxyPort,
          });

    let settled = false;
    let responseBuffer = Buffer.alloc(0);

    const finish = (err: Error | null, socket?: Socket) => {
      if (settled) return;
      settled = true;
      callback(err, socket);
    };

    const fail = (message: string, cause?: unknown) => {
      const error =
        cause instanceof Error
          ? new Error(`[ws-proxy] ${message}: ${cause.message}`)
          : createProxyTunnelError(message);
      proxySocket.destroy();
      finish(error);
    };

    proxySocket.once('error', (err) => {
      fail(`Proxy connect failed via ${this.proxyUrl.host}`, err);
    });

    proxySocket.once('connect', () => {
      const proxyAuthorization = buildProxyAuthorization(this.proxyUrl);
      const requestLines = [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`,
        'Proxy-Connection: Keep-Alive',
      ];

      if (proxyAuthorization) {
        requestLines.push(`Proxy-Authorization: Basic ${proxyAuthorization}`);
      }

      requestLines.push('', '');
      proxySocket.write(requestLines.join('\r\n'));
    });

    proxySocket.on('data', (chunk: Buffer) => {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);
      const headerEnd = responseBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      proxySocket.removeAllListeners('data');

      const headerText = responseBuffer.subarray(0, headerEnd).toString('utf8');
      if (!/^HTTP\/1\.[01] 200\b/m.test(headerText)) {
        fail(`Proxy tunnel rejected ${targetHost}:${targetPort} (${headerText.split('\r\n')[0]})`);
        return;
      }

      const remainder = responseBuffer.subarray(headerEnd + 4);
      const tlsOptions: TlsConnectionOptions = {
        socket: proxySocket,
        servername: options.servername || targetHost,
      };

      if (typeof options.rejectUnauthorized === 'boolean') {
        tlsOptions.rejectUnauthorized = options.rejectUnauthorized;
      }

      const secureSocket = tlsConnect(tlsOptions);
      secureSocket.once('error', (err) => {
        fail(`TLS handshake failed for ${targetHost}:${targetPort}`, err);
      });
      secureSocket.once('secureConnect', () => {
        if (remainder.length > 0) {
          secureSocket.unshift(remainder);
        }
        finish(null, secureSocket);
      });
    });

    return proxySocket;
  }
}

const agentCache = new Map<string, HttpConnectTunnelAgent>();

function getCachedAgent(proxyUrl: URL): HttpConnectTunnelAgent {
  const cacheKey = proxyUrl.toString();
  const existing = agentCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const agent = new HttpConnectTunnelAgent(proxyUrl);
  agentCache.set(cacheKey, agent);
  return agent;
}

export function getWebSocketClientOptions(targetUrl: string): {
  agent?: HttpsAgent;
  followRedirects: boolean;
  maxRedirects: number;
} {
  const proxyUrl = resolveProxyUrl(targetUrl);
  if (!proxyUrl) {
    return {
      followRedirects: true,
      maxRedirects: 5,
    };
  }

  if (proxyUrl.protocol !== 'http:' && proxyUrl.protocol !== 'https:') {
    console.warn(
      `[ws-proxy] Unsupported proxy protocol "${proxyUrl.protocol}" for ${targetUrl}; using direct websocket`
    );
    return {
      followRedirects: true,
      maxRedirects: 5,
    };
  }

  return {
    agent: getCachedAgent(proxyUrl),
    followRedirects: true,
    maxRedirects: 5,
  };
}
