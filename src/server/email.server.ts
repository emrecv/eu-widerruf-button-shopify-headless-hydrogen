/**
 * Transaktionale E-Mails über Resend — neu gestaltet: minimalistisch, schwarzweiß,
 * voll mobil-responsiv, mit Produkt-Thumbnails, ohne extreme Letterspacings und ohne
 * überflüssige Sub-Headings.
 *
 * Marke, Absender und optionales Logo kommen aus der Config. Ohne `RESEND_API_KEY`
 * bzw. `WIDERRUF_FROM_EMAIL` werden Mails still übersprungen (der Widerruf ist bereits
 * an der Bestellung vermerkt — Mails sind nicht erfolgskritisch).
 */

import type {WiderrufConfig} from './config';

export interface EmailItem {
  title: string;
  variant?: string | null;
  quantity: number;
  imageUrl?: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function send(
  cfg: WiderrufConfig,
  opts: {to: string; subject: string; html: string; replyTo?: string},
): Promise<{ok: boolean; error?: string}> {
  if (!cfg.resendKey || !cfg.fromEmail) {
    console.warn('[widerruf] E-Mail übersprungen — RESEND_API_KEY/WIDERRUF_FROM_EMAIL fehlt.');
    return {ok: false, error: 'E-Mail nicht konfiguriert'};
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${cfg.brandName} <${cfg.fromEmail}>`,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        ...(opts.replyTo ? {reply_to: opts.replyTo} : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[widerruf] Resend error', res.status, body);
      return {ok: false, error: `Resend ${res.status}`};
    }
    return {ok: true};
  } catch (err) {
    console.error('[widerruf] Resend fetch failed', err);
    return {ok: false, error: String(err)};
  }
}

// ── Bausteine ────────────────────────────────────────────────────────────────────

const C = {
  bg: '#ffffff',
  panel: '#fafafa',
  fg: '#111111',
  muted: '#6b7280',
  line: '#e5e7eb',
};

function header(cfg: WiderrufConfig): string {
  if (cfg.logoUrl) {
    return `<img src="${escapeHtml(cfg.logoUrl)}" alt="${escapeHtml(cfg.brandName)}" height="28" style="display:block;height:28px;width:auto;border:0;" />`;
  }
  return `<span style="font-size:18px;font-weight:700;color:${C.fg};">${escapeHtml(cfg.brandName)}</span>`;
}

function button(label: string, href: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:${C.fg};color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:13px 22px;border-radius:8px;">${escapeHtml(label)}</a>`;
}

function itemsTable(items: EmailItem[]): string {
  if (!items.length) return '';
  const rows = items
    .map((it) => {
      const variant =
        it.variant && it.variant !== 'Default Title'
          ? `<div style="font-size:13px;color:${C.muted};margin-top:2px;">${escapeHtml(it.variant)}</div>`
          : '';
      const thumb = it.imageUrl
        ? `<img src="${escapeHtml(it.imageUrl)}" width="56" height="56" alt="" style="display:block;width:56px;height:56px;border-radius:8px;object-fit:cover;background:${C.line};" />`
        : `<div style="width:56px;height:56px;border-radius:8px;background:${C.line};"></div>`;
      return `
        <tr>
          <td width="56" style="padding:10px 14px 10px 0;vertical-align:top;">${thumb}</td>
          <td style="padding:10px 0;vertical-align:top;">
            <div style="font-size:15px;font-weight:600;color:${C.fg};">${escapeHtml(it.title)}</div>
            ${variant}
            <div style="font-size:13px;color:${C.muted};margin-top:2px;">Menge: ${it.quantity}</div>
          </td>
        </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line};margin-top:8px;">${rows}</table>`;
}

function shell(cfg: WiderrufConfig, title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light only" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.panel};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.fg};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:${C.bg};border:1px solid ${C.line};border-radius:14px;overflow:hidden;">
          <tr><td style="padding:28px 28px 0 28px;">${header(cfg)}</td></tr>
          <tr><td style="padding:20px 28px 32px 28px;">${body}</td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
          <tr><td style="padding:16px 28px;text-align:center;font-size:11px;color:${C.muted};">
            ${escapeHtml(cfg.brandName)}
          </td></tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 14px 0;font-size:21px;line-height:1.3;font-weight:700;color:${C.fg};">${escapeHtml(text)}</h1>`;
}

function para(html: string): string {
  return `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.65;color:${C.muted};">${html}</p>`;
}

// ── 1) Kunden-Eingangsbestätigung (§ 356a BGB) ───────────────────────────────────

export interface ConfirmationData {
  orderName: string;
  name: string;
  email: string;
  submittedAt: string;
  items: EmailItem[];
  reason?: string;
  statusUrl: string;
  widerrufsrechtUrl?: string;
}

export function buildConfirmationHtml(cfg: WiderrufConfig, d: ConfirmationData): string {
  const body = `
    ${heading('Widerruf eingegangen')}
    ${para(`Hallo ${escapeHtml(d.name)}, wir bestätigen den Eingang deines Widerrufs zur Bestellung <strong style="color:${C.fg};">${escapeHtml(d.orderName)}</strong> am ${escapeHtml(d.submittedAt)}. Diese E-Mail dient als Bestätigung auf einem dauerhaften Datenträger (§ 356a BGB) — bitte aufbewahren.`)}
    ${itemsTable(d.items)}
    ${d.reason ? para(`<strong style="color:${C.fg};">Begründung:</strong> ${escapeHtml(d.reason)}`) : ''}
    ${para('Wir prüfen deinen Widerruf und senden dir in Kürze einen Rücksendeschein. Den aktuellen Stand kannst du jederzeit hier einsehen:')}
    <div style="margin:4px 0 8px 0;">${button('Status ansehen', d.statusUrl)}</div>
    ${d.widerrufsrechtUrl ? para(`<a href="${escapeHtml(d.widerrufsrechtUrl)}" style="color:${C.muted};">Widerrufsrecht &amp; Richtlinien</a>`) : ''}
  `;
  return shell(cfg, 'Widerruf eingegangen', body);
}

export function sendConfirmationEmail(cfg: WiderrufConfig, d: ConfirmationData) {
  return send(cfg, {
    to: d.email,
    subject: `Eingangsbestätigung deines Widerrufs — ${d.orderName}`,
    html: buildConfirmationHtml(cfg, d),
  });
}

// ── 2) Team-Benachrichtigung ─────────────────────────────────────────────────────

export interface TeamData {
  to: string;
  orderName: string;
  name: string;
  email: string;
  submittedAt: string;
  items: EmailItem[];
  reason?: string;
  adminOrderUrl?: string;
}

export function buildTeamHtml(cfg: WiderrufConfig, d: TeamData): string {
  const body = `
    ${heading(`Neuer Widerruf — ${d.orderName}`)}
    ${para(`Eingegangen am ${escapeHtml(d.submittedAt)} von <strong style="color:${C.fg};">${escapeHtml(d.name)}</strong> (${escapeHtml(d.email)}). Bitte Rücksendeschein vorbereiten und im Admin am Metafeld <code>widerruf.label_url</code> hinterlegen.`)}
    ${itemsTable(d.items)}
    ${d.reason ? para(`<strong style="color:${C.fg};">Begründung:</strong> ${escapeHtml(d.reason)}`) : ''}
    ${d.adminOrderUrl ? `<div style="margin:8px 0;">${button('Bestellung im Admin öffnen', d.adminOrderUrl)}</div>` : ''}
  `;
  return shell(cfg, 'Neuer Widerruf', body);
}

export function sendTeamNotification(cfg: WiderrufConfig, d: TeamData) {
  return send(cfg, {
    to: d.to,
    replyTo: d.email,
    subject: `⚠ Neuer Widerruf — ${d.orderName}`,
    html: buildTeamHtml(cfg, d),
  });
}

// ── 3) Rücksendeschein-Mail ──────────────────────────────────────────────────────

export interface LabelReadyData {
  orderName: string;
  name: string;
  email: string;
  labelUrl: string;
  statusUrl: string;
}

export function buildLabelReadyHtml(cfg: WiderrufConfig, d: LabelReadyData): string {
  const body = `
    ${heading('Dein Rücksendeschein ist da')}
    ${para(`Hallo${d.name ? ` ${escapeHtml(d.name)}` : ''}, für deinen Widerruf zur Bestellung <strong style="color:${C.fg};">${escapeHtml(d.orderName)}</strong> steht jetzt der Rücksendeschein bereit. Bitte sende die Ware innerhalb von 14 Tagen zurück.`)}
    <div style="margin:4px 0 16px 0;">${button('Rücksendeschein herunterladen', d.labelUrl)}</div>
    ${para(`Den Status deines Widerrufs siehst du <a href="${escapeHtml(d.statusUrl)}" style="color:${C.fg};">hier</a>.`)}
  `;
  return shell(cfg, 'Rücksendeschein', body);
}

export function sendLabelReadyEmail(cfg: WiderrufConfig, d: LabelReadyData) {
  return send(cfg, {
    to: d.email,
    subject: `Dein Rücksendeschein — ${d.orderName}`,
    html: buildLabelReadyHtml(cfg, d),
  });
}
