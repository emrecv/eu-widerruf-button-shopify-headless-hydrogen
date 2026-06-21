/**
 * Sicherheits-Helfer: IP-basiertes Rate-Limiting (Schutz gegen das Durchprobieren
 * von Bestellnummern), Cookie-Parsing und HMAC-Verifikation für Shopify-Webhooks.
 *
 * Bewusst ohne Node-spezifische APIs (Web Crypto), damit es auf Oxygen/Cloudflare
 * Workers genauso läuft wie lokal.
 */

function getStore<T>(key: string, init: () => T): T {
  const g = globalThis as Record<string, unknown>;
  if (!g[key]) g[key] = init();
  return g[key] as T;
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
  blockedUntil: number;
}

export interface RateLimitResult {
  blocked: boolean;
  retryAfter?: number;
}

export function checkRateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
  blockMs: number,
): RateLimitResult {
  const store = getStore<Map<string, RateLimitRecord>>(
    '__WIDERRUF_RATE_LIMITS',
    () => new Map(),
  );
  const now = Date.now();
  const record = store.get(key);

  if (record?.blockedUntil && now < record.blockedUntil) {
    return {blocked: true, retryAfter: Math.ceil((record.blockedUntil - now) / 1000)};
  }

  if (!record || now > record.resetAt) {
    store.set(key, {count: 1, resetAt: now + windowMs, blockedUntil: 0});
    return {blocked: false};
  }

  record.count++;
  if (record.count > maxAttempts) {
    record.blockedUntil = now + blockMs;
    return {blocked: true, retryAfter: Math.ceil(blockMs / 1000)};
  }

  return {blocked: false};
}

export function getClientIP(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '127.0.0.1'
  );
}

export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return `${seconds} Sekunden`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} Minute${minutes !== 1 ? 'n' : ''}`;
}

export function getCookieValue(cookieHeader: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Verifiziert die Shopify-Webhook-Signatur: Base64(HMAC-SHA256(secret, rawBody))
 * muss dem Header `X-Shopify-Hmac-Sha256` entsprechen. Vergleich in konstanter Zeit.
 */
export async function verifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!hmacHeader || !secret) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    {name: 'HMAC', hash: 'SHA-256'},
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(rawBody),
  );
  const computed = btoa(String.fromCharCode(...new Uint8Array(signature)));

  if (computed.length !== hmacHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  }
  return diff === 0;
}
