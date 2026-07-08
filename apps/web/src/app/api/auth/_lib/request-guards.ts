import { NextRequest, NextResponse } from 'next/server';

export const MAX_API_ROUTE_BODY_BYTES = 100_000;

type LimitedTextResult =
  | { ok: true; text: string }
  | { ok: false; response: NextResponse };

type LimitedJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; response: NextResponse };

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function rejectCrossOriginMutation(req: NextRequest): NextResponse | null {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return null;

  const expectedOrigin = req.nextUrl.origin;
  const origin = req.headers.get('origin');
  if (origin) {
    return origin === expectedOrigin ? null : forbiddenOriginResponse();
  }

  const referer = req.headers.get('referer');
  if (!referer) return null;

  try {
    return new URL(referer).origin === expectedOrigin ? null : forbiddenOriginResponse();
  } catch {
    return forbiddenOriginResponse();
  }
}

export async function readLimitedTextBody(
  req: NextRequest,
  maxBytes = MAX_API_ROUTE_BODY_BYTES,
): Promise<LimitedTextResult> {
  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const advertisedBytes = Number(contentLength);
    if (!Number.isFinite(advertisedBytes) || advertisedBytes < 0) {
      return {
        ok: false,
        response: NextResponse.json(
          { message: 'Invalid Content-Length', code: 'INVALID_CONTENT_LENGTH' },
          { status: 400 },
        ),
      };
    }
    if (advertisedBytes > maxBytes) {
      return { ok: false, response: bodyTooLargeResponse(maxBytes) };
    }
  }

  if (!req.body) return { ok: true, text: '' };

  const decoder = new TextDecoder();
  const reader = req.body.getReader();
  let bytesRead = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, response: bodyTooLargeResponse(maxBytes) };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, text };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { message: 'Invalid request body', code: 'INVALID_REQUEST_BODY' },
        { status: 400 },
      ),
    };
  }
}

export async function readLimitedJsonBody(
  req: NextRequest,
  maxBytes = MAX_API_ROUTE_BODY_BYTES,
): Promise<LimitedJsonResult> {
  const body = await readLimitedTextBody(req, maxBytes);
  if (!body.ok) return body;
  if (!body.text.trim()) return { ok: true, body: {} };

  try {
    return { ok: true, body: JSON.parse(body.text) as unknown };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { message: 'Invalid JSON body', code: 'INVALID_JSON_BODY' },
        { status: 400 },
      ),
    };
  }
}

function forbiddenOriginResponse(): NextResponse {
  return NextResponse.json(
    { message: 'Forbidden', code: 'CROSS_ORIGIN_MUTATION' },
    { status: 403 },
  );
}

function bodyTooLargeResponse(maxBytes: number): NextResponse {
  return NextResponse.json(
    { message: 'Payload too large', code: 'BODY_TOO_LARGE' },
    { status: 413, headers: { 'X-Max-Body-Bytes': String(maxBytes) } },
  );
}
