/**
 * Netlify serverless function: company-save-relay
 * Proxies Graph Capture → DiscoverEE graph_capture_api.php saves.
 * Used when the browser POST is blocked by CORS / network from Netlify.
 */

const DEFAULT_TARGET = 'https://www.discoveree.io/graph_capture_api.php';
const UPSTREAM_TIMEOUT_MS = 24000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://graph-capture.netlify.app',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const isAllowedDiscovereeTarget = (url) => {
  try {
    const parsed = new URL(String(url || ''));
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === 'www.discoveree.io' &&
      parsed.pathname.includes('graph_capture_api.php')
    );
  } catch {
    return false;
  }
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const targetUrl = String(body.target_url || DEFAULT_TARGET).trim() || DEFAULT_TARGET;
    const payload = body.payload;

    if (!isAllowedDiscovereeTarget(targetUrl)) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid DiscoverEE target_url' }),
      };
    }

    if (!payload || typeof payload !== 'object') {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing payload' }),
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let upstream;
    try {
      upstream = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          Origin: 'https://graph-capture.netlify.app',
          Referer: 'https://graph-capture.netlify.app/',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const rawText = await upstream.text();
    let parsed = null;
    try {
      const match = rawText.match(/[{\[][\s\S]*[}\]]/);
      parsed = JSON.parse(match ? match[0] : rawText);
    } catch {
      parsed = null;
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        upstream_status: upstream.status,
        upstream_ok: upstream.ok,
        raw_text: rawText,
        response: parsed,
        target_url: targetUrl,
      }),
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `Company save relay failed: ${error.message}`,
        upstream_ok: false,
        upstream_status: 502,
      }),
    };
  }
};
