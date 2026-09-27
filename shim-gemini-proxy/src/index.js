const ALLOWED_ORIGIN = 'https://yudai-hatano.github.io';
const ALLOWED_MODELS = ['gemini-3.5-flash', 'gemini-3.5-flash-lite'];
const DEFAULT_MODEL = 'gemini-3.5-flash';
const MAX_BODY_BYTES = 20 * 1024 * 1024; // 20MB (画像・PDF数枚分を想定)

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function jsonError(message, status, origin) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      if (origin !== ALLOWED_ORIGIN) return new Response('Forbidden', { status: 403 });
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (origin !== ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403 });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders(origin) });
    }

    const contentLength = Number(request.headers.get('Content-Length') || 0);
    if (contentLength && contentLength > MAX_BODY_BYTES) {
      return jsonError('Payload too large', 413, origin);
    }

    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES) {
      return jsonError('Payload too large', 413, origin);
    }

    let payload;
    try {
      payload = JSON.parse(new TextDecoder().decode(raw));
    } catch (e) {
      return jsonError('Invalid JSON body', 400, origin);
    }

    const requestedModel = payload.model;
    if (requestedModel && !ALLOWED_MODELS.includes(requestedModel)) {
      return jsonError(`Model not allowed: ${requestedModel}`, 400, origin);
    }
    const model = requestedModel || DEFAULT_MODEL;
    delete payload.model;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    let geminiResp;
    try {
      geminiResp = await fetch(geminiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return jsonError('Upstream request failed', 502, origin);
    }

    const respBody = await geminiResp.text();
    return new Response(respBody, {
      status: geminiResp.status,
      headers: {
        'Content-Type': geminiResp.headers.get('Content-Type') || 'application/json',
        ...corsHeaders(origin),
      },
    });
  },
};
