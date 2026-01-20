import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

const parseIntEnv = (name, fallback) => {
  const raw = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(raw) ? raw : fallback;
};

const normalizeUpstream = (raw) => {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const withScheme = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
  return new URL(withScheme);
};

const upstreams = String(process.env.UPSTREAMS || '')
  .split(',')
  .map((s) => normalizeUpstream(s))
  .filter(Boolean)
  .map((url) => ({
    url,
    healthy: false,
    lastStatus: null,
    lastCheckedAt: null,
  }));

if (upstreams.length === 0) {
  throw new Error('UPSTREAMS env is required (comma-separated list)');
}

const proxyPort = parseIntEnv('PROXY_PORT', 3002);
const healthPath = String(process.env.HEALTH_PATH || '/health');
const healthIntervalMs = Math.max(100, parseIntEnv('HEALTH_INTERVAL_MS', 500));
const healthTimeoutMs = Math.max(200, parseIntEnv('HEALTH_TIMEOUT_MS', 1000));
const upstreamTimeoutMs = Math.max(500, parseIntEnv('UPSTREAM_TIMEOUT_MS', 5000));
const maxBodyBytes = Math.max(64 * 1024, parseIntEnv('MAX_BODY_BYTES', 5 * 1024 * 1024));
const maxRetries = Math.max(0, parseIntEnv('MAX_RETRIES', 1));
const failStatusMin = Math.max(400, parseIntEnv('FAIL_STATUS_MIN', 500));

let rrIndex = 0;

const logHealthChange = (upstream, ok, status, reason) => {
  const statusText = status == null ? 'n/a' : String(status);
  const suffix = reason ? ` (${reason})` : '';
  // Log only on state transition to keep noise low.
  const prev = upstream.healthy;
  if (prev !== ok) {
    upstream.healthy = ok;
    console.log(
      `[proxy] upstream ${upstream.url.origin} healthy=${ok} status=${statusText}${suffix}`
    );
  }
};

const checkHealth = (upstream) => {
  const lib = upstream.url.protocol === 'https:' ? https : http;
  const req = lib.request(
    {
      method: 'GET',
      hostname: upstream.url.hostname,
      port: upstream.url.port || (upstream.url.protocol === 'https:' ? 443 : 80),
      path: healthPath,
      timeout: healthTimeoutMs,
      headers: { 'user-agent': 'memalerts-rolling-restart-proxy' },
    },
    (res) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      upstream.lastStatus = res.statusCode ?? null;
      upstream.lastCheckedAt = Date.now();
      res.resume();
      logHealthChange(upstream, ok, res.statusCode, null);
    }
  );
  req.on('timeout', () => {
    req.destroy(new Error('health_timeout'));
  });
  req.on('error', (err) => {
    upstream.lastStatus = null;
    upstream.lastCheckedAt = Date.now();
    logHealthChange(upstream, false, null, err?.message || 'health_error');
  });
  req.end();
};

const refreshHealth = () => {
  for (const upstream of upstreams) {
    checkHealth(upstream);
  }
};

const pickUpstream = (preferHealthy) => {
  const candidates = preferHealthy
    ? upstreams.filter((u) => u.healthy)
    : upstreams.slice();
  if (candidates.length === 0) return null;
  rrIndex = (rrIndex + 1) % candidates.length;
  return candidates[rrIndex];
};

const buildHeaders = (req, bodyLength) => {
  const headers = { ...req.headers };
  delete headers['content-length'];
  delete headers['transfer-encoding'];
  headers['x-forwarded-host'] = req.headers?.host || '';
  headers['x-forwarded-proto'] = 'http';
  headers['x-forwarded-port'] = String(proxyPort);
  if (bodyLength !== null) {
    headers['content-length'] = String(bodyLength);
  }
  return headers;
};

const canRetryMethod = (method) => {
  const m = String(method || 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD' || m === 'OPTIONS';
};

const proxyRequest = (req, res, body, attempt, preferHealthy) => {
  const upstream = pickUpstream(preferHealthy);
  if (!upstream) {
    res.statusCode = 502;
    res.end('No upstreams available');
    return;
  }

  const target = new URL(req.url || '/', upstream.url);
  const lib = target.protocol === 'https:' ? https : http;
  const headers = buildHeaders(req, body ? body.length : 0);

  const upstreamReq = lib.request(
    target,
    {
      method: req.method,
      headers: { ...headers, host: upstream.url.host },
      timeout: upstreamTimeoutMs,
    },
    (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 502;
      if (status >= failStatusMin) {
        logHealthChange(upstream, false, status, 'upstream_error');
      }

      if (
        status >= failStatusMin &&
        attempt < maxRetries &&
        canRetryMethod(req.method)
      ) {
        upstreamRes.resume();
        return proxyRequest(req, res, body, attempt + 1, true);
      }

      res.writeHead(status, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on('timeout', () => {
    upstreamReq.destroy(new Error('upstream_timeout'));
  });

  upstreamReq.on('error', (err) => {
    logHealthChange(upstream, false, null, err?.message || 'upstream_error');
    if (attempt < maxRetries && canRetryMethod(req.method)) {
      return proxyRequest(req, res, body, attempt + 1, true);
    }
    res.statusCode = 502;
    res.end('Upstream connection failed');
  });

  if (body && body.length > 0) {
    upstreamReq.write(body);
  }
  upstreamReq.end();
};

const server = http.createServer((req, res) => {
  let size = 0;
  const chunks = [];
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > maxBodyBytes) {
      res.statusCode = 413;
      res.end('Payload too large');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    const body = chunks.length > 0 ? Buffer.concat(chunks, size) : null;
    proxyRequest(req, res, body, 0, true);
  });
});

server.on('upgrade', (req, socket) => {
  socket.end('HTTP/1.1 501 Not Implemented\r\n\r\n');
});

server.listen(proxyPort, () => {
  console.log(
    `[proxy] listening on http://localhost:${proxyPort} -> ${upstreams
      .map((u) => u.url.origin)
      .join(', ')}`
  );
  refreshHealth();
  setInterval(refreshHealth, healthIntervalMs).unref();
});

const shutdown = () => {
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
