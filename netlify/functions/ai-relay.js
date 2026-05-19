/**
 * Netlify serverless function: ai-relay
 * Proxies AI extraction requests to DiscoverEE's vision_upload.php.
 * Runs on Netlify/AWS Lambda IPs which are not blocked by Imunify360.
 * Returns the same response shape as the Render backend relay.
 */

const PRIMARY_URL = 'https://www.discoveree.io/vision_upload.php';

function parseJsonFromText(rawText) {
  try {
    const objectStart = rawText.indexOf('{');
    const arrayStart = rawText.indexOf('[');
    const starts = [objectStart, arrayStart].filter((i) => i >= 0);
    if (starts.length === 0) return rawText;
    const matchStart = Math.min(...starts);
    const objectEnd = rawText.lastIndexOf('}');
    const arrayEnd = rawText.lastIndexOf(']');
    const matchEnd = Math.max(objectEnd, arrayEnd);
    if (matchEnd <= matchStart) return rawText;
    return JSON.parse(rawText.substring(matchStart, matchEnd + 1));
  } catch {
    return rawText;
  }
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://graph-capture.netlify.app',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

exports.handler = async function (event) {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}');

    // Normalize and strip base64 data URL prefix
    let base64image = String(payload.base64image || '');
    base64image = base64image.replace(/^data:[^;]+;base64,/, '').trim();
    // Remove any non-base64 characters
    base64image = base64image.replace(/[^A-Za-z0-9+/=]/g, '');

    if (!base64image) {
      return {
        statusCode: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required field: base64image' }),
      };
    }

    // Build FormData to send to DiscoverEE (multipart/form-data)
    const formData = new FormData();
    const skipKeys = new Set(['base64image']);
    for (const [key, value] of Object.entries(payload)) {
      if (!skipKeys.has(key)) {
        formData.append(key, String(value == null ? '' : value));
      }
    }
    formData.append('base64image', base64image);

    const requestHeaders = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Origin: 'https://graph-capture.netlify.app',
      Referer: 'https://graph-capture.netlify.app/',
    };

    const response = await fetch(PRIMARY_URL, {
      method: 'POST',
      body: formData,
      headers: requestHeaders,
    });

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const parsedResponse = parseJsonFromText(rawText);

    const attemptResult = {
      target_url: PRIMARY_URL,
      upstream_status: response.status,
      upstream_ok: response.ok,
      content_type: contentType,
      raw_text: rawText,
      response: parsedResponse,
    };

    const result = {
      ...attemptResult,
      attempts: [attemptResult],
    };

    return {
      statusCode: response.status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: `Netlify relay failed: ${error.message}`,
        upstream_ok: false,
        upstream_status: 502,
      }),
    };
  }
};
