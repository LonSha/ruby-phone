#!/usr/bin/env node
/*
 * Local OpenAI-compatible image relay for mobile browsers.
 *
 * The browser calls this local server, and this server forwards requests to
 * the real public image endpoint. This avoids browser CORS failures on mobile.
 */

const http = require('http');
const { URL } = require('url');

const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const CORS_ALLOW_HEADERS = 'Authorization,Content-Type,Accept,X-OpenAI-Image-Relay-Target';

const port = readPort(process.env.PORT || process.env.OPENAI_IMAGE_RELAY_PORT, DEFAULT_PORT);
const host = String(process.env.HOST || process.env.OPENAI_IMAGE_RELAY_HOST || '127.0.0.1').trim() || '127.0.0.1';
const defaultTargetBaseUrl = normalizeTargetBaseUrl(process.env.OPENAI_IMAGE_RELAY_TARGET || process.env.PHONE_OPENAI_IMAGE_TARGET || '');
const fallbackApiKey = String(process.env.OPENAI_IMAGE_RELAY_KEY || process.env.PHONE_OPENAI_IMAGE_KEY || '').trim();

const server = http.createServer(async (req, res) => {
    try {
        setCorsHeaders(res);

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.url === '/health' || req.url === '/healthz') {
            sendJson(res, 200, {
                ok: true,
                defaultTarget: defaultTargetBaseUrl,
                routes: ['/v1/models', '/v1/images/generations']
            });
            return;
        }

        const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
        if (!isAllowedRoute(req.method, requestUrl.pathname)) {
            sendJson(res, 404, {
                error: {
                    message: 'Only GET /v1/models and POST /v1/images/generations are supported by this relay.'
                }
            });
            return;
        }

        const body = req.method === 'GET' ? null : await readRequestBody(req);
        const targetBaseUrl = resolveTargetBaseUrl(req);
        const targetUrl = new URL(requestUrl.pathname.replace(/^\/+/, ''), `${targetBaseUrl}/`);
        targetUrl.search = requestUrl.search;

        const headers = buildForwardHeaders(req);
        const response = await fetch(targetUrl, {
            method: req.method,
            headers,
            body,
            signal: AbortSignal.timeout(readTimeoutMs())
        });

        const responseBody = Buffer.from(await response.arrayBuffer());
        const responseHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
            'Cache-Control': 'no-store'
        };
        const contentType = response.headers.get('content-type');
        if (contentType) responseHeaders['Content-Type'] = contentType;
        res.writeHead(response.status, responseHeaders);
        res.end(responseBody);

        console.log(`${new Date().toISOString()} ${req.method} ${requestUrl.pathname} -> ${response.status}`);
    } catch (error) {
        const status = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 504 : 502;
        sendJson(res, status, {
            error: {
                message: `OpenAI image relay failed: ${error?.message || String(error)}`
            }
        });
        console.error(`${new Date().toISOString()} relay error:`, error);
    }
});

server.listen(port, host, () => {
    console.log(`OpenAI image local relay listening on http://${host}:${port}`);
    console.log('Set the phone GPT public relay URL to this local address.');
    if (defaultTargetBaseUrl) {
        console.log(`Default target: ${defaultTargetBaseUrl}`);
    }
});

function readPort(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function readTimeoutMs() {
    const parsed = Number.parseInt(String(process.env.OPENAI_IMAGE_RELAY_TIMEOUT_MS || ''), 10);
    return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 180000;
}

function normalizeTargetBaseUrl(value) {
    const raw = String(value || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error('OpenAI image relay target URL is invalid.');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('OPENAI_IMAGE_RELAY_TARGET must start with http:// or https://');
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/+$/, '');
}

function resolveTargetBaseUrl(req) {
    const headerTarget = String(req.headers['x-openai-image-relay-target'] || '').trim();
    const target = normalizeTargetBaseUrl(headerTarget || defaultTargetBaseUrl);
    if (!target) {
        throw new Error('Missing target. Send X-OpenAI-Image-Relay-Target or set OPENAI_IMAGE_RELAY_TARGET.');
    }
    return target;
}

function isAllowedRoute(method, pathname) {
    const normalized = String(pathname || '').replace(/\/+$/, '') || '/';
    return (method === 'GET' && normalized === '/v1/models') ||
        (method === 'POST' && normalized === '/v1/images/generations');
}

function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
    res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload) {
    setCorsHeaders(res);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(payload));
}

function buildForwardHeaders(req) {
    const headers = {
        Accept: req.headers.accept || 'application/json'
    };

    const contentType = req.headers['content-type'];
    if (contentType) headers['Content-Type'] = contentType;

    const authorization = String(req.headers.authorization || '').trim();
    if (authorization) {
        headers.Authorization = authorization;
    } else if (fallbackApiKey) {
        headers.Authorization = `Bearer ${fallbackApiKey}`;
    }

    return headers;
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;

        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new Error('Request body is too large.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
