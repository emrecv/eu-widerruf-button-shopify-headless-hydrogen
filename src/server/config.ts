/**
 * Liest die Widerruf-Konfiguration aus der Hydrogen-Umgebung (`context.env`).
 *
 * Alle Werte sind Umgebungsvariablen, damit das Paket ohne Code-Änderung in jedem
 * Storefront läuft. Pflicht ist nur die Shop-Domain plus eine Token-Quelle
 * (Client-Credentials einer Dev-Dashboard-App **oder** ein statischer Admin-Token).
 * E-Mail- und Marken-Werte sind optional — ohne sie läuft der Flow weiter, es werden
 * nur keine Mails versendet.
 */

export const ADMIN_API_VERSION = '2025-07';

export interface WiderrufConfig {
  storeDomain?: string;
  clientId?: string;
  clientSecret?: string;
  staticToken?: string;
  resendKey?: string;
  teamEmail?: string;
  brandName: string;
  fromEmail?: string;
  logoUrl?: string;
  webhookSecret?: string;
}

function str(env: Record<string, unknown>, key: string): string | undefined {
  const value = env[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function readConfig(env: Record<string, unknown>): WiderrufConfig {
  const clientSecret = str(env, 'PRIVATE_ADMIN_CLIENT_SECRET');
  return {
    storeDomain: str(env, 'PUBLIC_STORE_DOMAIN'),
    clientId: str(env, 'PRIVATE_ADMIN_CLIENT_ID'),
    clientSecret,
    staticToken: str(env, 'PRIVATE_ADMIN_API_TOKEN'),
    resendKey: str(env, 'RESEND_API_KEY'),
    teamEmail: str(env, 'WITHDRAWAL_NOTIFY_EMAIL'),
    brandName: str(env, 'WIDERRUF_BRAND_NAME') ?? 'Shop',
    fromEmail: str(env, 'WIDERRUF_FROM_EMAIL'),
    logoUrl: str(env, 'WIDERRUF_LOGO_URL'),
    // Für die Webhook-HMAC-Prüfung. Fällt auf das App-Secret zurück.
    webhookSecret: str(env, 'WIDERRUF_WEBHOOK_SECRET') ?? clientSecret,
  };
}

/** True, wenn genug konfiguriert ist, um die Admin-API anzusprechen. */
export function isAdminConfigured(cfg: WiderrufConfig): boolean {
  return Boolean(cfg.storeDomain && (cfg.staticToken || (cfg.clientId && cfg.clientSecret)));
}
