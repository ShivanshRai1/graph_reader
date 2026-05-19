/**
 * Netlify serverless function: ai-relay
 * Proxies AI extraction requests to DiscoverEE's vision_upload.php.
 * Runs on Netlify/AWS Lambda IPs which are not blocked by Imunify360.
 * Returns the same response shape as the Render backend relay.
 */

const PRIMARY_URL = 'https://www.discoveree.io/vision_upload.php';

function toBase64Uint8Array(base64) {
  return Uint8Array.from(Buffer.from(base64, 'base64'));
}

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

function hasValidGraphId(parsedResponse, rawText) {
  if (parsedResponse && typeof parsedResponse === 'object') {
    const directGraphId = parsedResponse.graph_id ?? parsedResponse.graphId;
    if (directGraphId !== undefined && directGraphId !== null && String(directGraphId).trim() !== '') {
      return true;
    }
  }

  const raw = String(rawText || '');
  return /"graph_id"\s*:\s*"?\d+"?/i.test(raw);
}

async function postAttempt({ body, requestHeaders, mode }) {
  const response = await fetch(PRIMARY_URL, {
    method: 'POST',
    body,
    headers: requestHeaders,
  });

  const rawText = await response.text();
  const contentType = response.headers.get('content-type') || '';
  const parsedResponse = parseJsonFromText(rawText);

  return {
    mode,
    target_url: PRIMARY_URL,
    upstream_status: response.status,
    upstream_ok: response.ok,
    content_type: contentType,
    raw_text: rawText,
    response: parsedResponse,
    valid_graph_id: hasValidGraphId(parsedResponse, rawText),
  };
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

    const firstAttempt = attempts[0];
    if (!firstAttempt.valid_graph_id) {
      const formDataPrefixed = new FormData();
      for (const [key, value] of Object.entries(normalizedPayload)) {
        if (key === 'base64image') {
          formDataPrefixed.append(key, `data:image/png;base64,${value}`);
        } else {
          formDataPrefixed.append(key, value);
        }
      }
      attempts.push(await postAttempt({ body: formDataPrefixed, requestHeaders, mode: 'multipart_data_uri_base64' }));
    }

    const secondAttempt = attempts[attempts.length - 1];
    if (!secondAttempt.valid_graph_id) {
      try {
        const imageBytes = toBase64Uint8Array(base64image);
        const imageBlob = new Blob([imageBytes], { type: 'image/png' });

        const formDataFile = new FormData();
        for (const [key, value] of Object.entries(normalizedPayload)) {
          if (key !== 'base64image') {
            formDataFile.append(key, value);
          }
        }
        formDataFile.append('base64image', base64image);
        formDataFile.append('image', imageBlob, 'capture.png');
        formDataFile.append('file', imageBlob, 'capture.png');
        attempts.push(await postAttempt({ body: formDataFile, requestHeaders, mode: 'multipart_with_file_blob' }));
      } catch (fileAttemptError) {
        attempts.push({
          mode: 'multipart_with_file_blob',
          target_url: PRIMARY_URL,
          upstream_status: 500,
          upstream_ok: false,
          content_type: 'application/json',
          raw_text: `File blob conversion failed: ${fileAttemptError.message}`,
          response: { error: `File blob conversion failed: ${fileAttemptError.message}` },
          valid_graph_id: false,
        });
      }
    }

    let finalAttempt = attempts.find((attempt) => attempt.valid_graph_id);
    if (!finalAttempt) {
      finalAttempt = attempts[attempts.length - 1] || firstAttempt;
    }

    const result = {
      target_url: finalAttempt.target_url,
      upstream_status: finalAttempt.upstream_status,
      upstream_ok: finalAttempt.upstream_ok,
      content_type: finalAttempt.content_type,
      raw_text: finalAttempt.raw_text,
      response: finalAttempt.response,
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
