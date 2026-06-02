/**
 * Netlify serverless function: ai-relay
 * Proxies AI extraction requests to DiscoverEE's AI endpoints.
 * Runs on Netlify/AWS Lambda IPs which are not blocked by Imunify360.
 * Returns the same response shape as the Render backend relay.
 */

const PRIMARY_URL = 'https://www.discoveree.io/vision_upload.php';
const BACKUP_URL = 'https://www.discoveree.io/graph_capture_api.php';
// Set false to test vision_upload.php only (no graph_capture_api.php fallback).
const AI_EXTRACTION_USE_BACKUP_ENDPOINT = false;
// Netlify functions cap around 26s — one upstream call only on primary.
const UPSTREAM_TIMEOUT_MS = 24000;

function parseJsonFromText(rawText) {
  const trimmed = String(rawText || '').trim();
  if (/^\d+$/.test(trimmed) && Number(trimmed) > 0) {
    return { graph_id: Number(trimmed) };
  }

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

function hasValidGraphId(parsedResponse, rawText) {
  if (parsedResponse && typeof parsedResponse === 'object') {
    const directGraphId = parsedResponse.graph_id ?? parsedResponse.graphId;
    if (directGraphId !== undefined && directGraphId !== null && String(directGraphId).trim() !== '') {
      return true;
    }
  }

  if (typeof parsedResponse === 'number' && isPositiveIntegerId(parsedResponse)) {
    return true;
  }

  if (typeof parsedResponse === 'string' && isPositiveIntegerId(parsedResponse.trim())) {
    return true;
  }

  const raw = String(rawText || '').trim();
  if (isPositiveIntegerId(raw)) {
    return true;
  }

  return /"graph_id"\s*:\s*"?\d+"?/i.test(raw);
}

function shouldUseBackupEndpoint(attempt) {
  const contentType = String(attempt?.content_type || '').toLowerCase();
  const rawText = String(attempt?.raw_text || '');
  const lowerRawText = rawText.toLowerCase();
  const upstreamStatus = Number(attempt?.upstream_status || 0);

  if (lowerRawText.includes('resource_exhausted') || lowerRawText.includes('quota exceeded')) {
    return false;
  }

  return (
    contentType.includes('text/html') ||
    lowerRawText.includes('imunify360') ||
    rawText.includes('Invalid base64 format') ||
    (!attempt?.upstream_ok && upstreamStatus >= 500 && rawText.trim() === '')
  );
}

function isPositiveIntegerId(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+$/.test(normalized)) return false;
  return Number(normalized) > 0;
}

function normalizeIdentifier(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (['0', 'null', 'undefined', 'nan', 'false'].includes(lower)) {
    return '';
  }
  return normalized;
}

async function postAttempt({ body, requestHeaders, mode, targetUrl = PRIMARY_URL }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      body,
      headers: requestHeaders,
      signal: controller.signal,
    });

    const rawText = await response.text();
    const contentType = response.headers.get('content-type') || '';
    const parsedResponse = parseJsonFromText(rawText);

    return {
      mode,
      target_url: targetUrl,
      upstream_status: response.status,
      upstream_ok: response.ok,
      content_type: contentType,
      raw_text: rawText,
      response: parsedResponse,
      valid_graph_id: hasValidGraphId(parsedResponse, rawText),
    };
  } catch (error) {
    const isAbort = error?.name === 'AbortError';
    const message = isAbort
      ? `Upstream timeout after ${UPSTREAM_TIMEOUT_MS}ms`
      : `Upstream request failed: ${error?.message || 'unknown error'}`;

    return {
      mode,
      target_url: targetUrl,
      upstream_status: isAbort ? 504 : 502,
      upstream_ok: false,
      content_type: 'application/json',
      raw_text: message,
      response: { error: message },
      valid_graph_id: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

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

    // Build the normalized payload (all values as strings)
    const normalizedPayload = {};
    for (const [key, value] of Object.entries(payload)) {
      normalizedPayload[key] = value == null ? '' : String(value);
    }
    normalizedPayload['base64image'] = base64image;

    const incomingGraphId = String(normalizedPayload['graph_id'] || '').trim();
    const hasValidIncomingGraphId = isPositiveIntegerId(incomingGraphId);

    if (!hasValidIncomingGraphId) {
      delete normalizedPayload['graph_id'];
      delete normalizedPayload['return_graph_id'];

      const incomingIdentifier = normalizeIdentifier(normalizedPayload['identifier']);
      normalizedPayload['identifier'] = incomingIdentifier || `ai_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
    }

    if (!normalizedPayload['action']) {
      normalizedPayload['action'] = 'graphcapture';
    }

    const requestHeaders = {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Origin: 'https://graph-capture.netlify.app',
      Referer: 'https://graph-capture.netlify.app/',
      Connection: 'keep-alive',
      'Cache-Control': 'max-age=0',
    };

    const attempts = [];

    const formDataRaw = new FormData();
    for (const [key, value] of Object.entries(normalizedPayload)) {
      formDataRaw.append(key, value);
    }
    attempts.push(await postAttempt({ body: formDataRaw, requestHeaders, mode: 'multipart_raw_base64' }));

    const primaryAttempt = attempts[0];
    if (AI_EXTRACTION_USE_BACKUP_ENDPOINT && !primaryAttempt.valid_graph_id && shouldUseBackupEndpoint(primaryAttempt)) {
      const backupJsonPayload = { ...normalizedPayload, base64image };
      attempts.push(await postAttempt({
        body: JSON.stringify(backupJsonPayload),
        requestHeaders: {
          ...requestHeaders,
          'Content-Type': 'application/json',
        },
        mode: 'backup_json_raw_base64',
        targetUrl: BACKUP_URL,
      }));
    }

    let finalAttempt = attempts.find((attempt) => attempt.valid_graph_id);
    if (!finalAttempt) {
      finalAttempt = attempts[attempts.length - 1] || primaryAttempt;
    }

    const result = {
      target_url: finalAttempt.target_url,
      upstream_status: finalAttempt.upstream_status,
      upstream_ok: finalAttempt.upstream_ok,
      content_type: finalAttempt.content_type,
      raw_text: finalAttempt.raw_text,
      response: finalAttempt.response,
      relay_context: {
        incoming_graph_id: incomingGraphId,
        forwarded_graph_id: String(normalizedPayload['graph_id'] || ''),
        forwarded_identifier: String(normalizedPayload['identifier'] || ''),
      },
      attempts,
    };

    return {
      statusCode: finalAttempt.upstream_status,
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
