import {readConfig} from '../server/config';
import {verifyWebhookHmac} from '../server/security.server';
import {loadOrderForLabelEmail, markLabelEmailed} from '../server/admin.server';
import {sendLabelReadyEmail} from '../server/email.server';

interface ActionArgs {
  request: Request;
  context: unknown;
}

const STATUS_PATH = '/widerruf/status';

/**
 * Handler für den `orders/updated`-Webhook. Sobald der Verkäufer im Shopify-Admin
 * das Metafeld `widerruf.label_url` an einer Bestellung setzt, schickt dieser Handler
 * dem Kunden einmalig die Rücksendeschein-Mail (Idempotenz über `label_emailed_at`).
 *
 * Antwortet immer schnell mit 200 (außer bei ungültiger Signatur), damit Shopify den
 * Webhook nicht als fehlgeschlagen markiert und erneut sendet.
 */
export async function widerrufWebhookAction({
  request,
  context,
}: ActionArgs): Promise<Response> {
  const env = ((context as {env?: Record<string, unknown>}).env ?? {}) as Record<
    string,
    unknown
  >;
  const cfg = readConfig(env);

  const raw = await request.text();
  const hmac = request.headers.get('X-Shopify-Hmac-Sha256');
  const valid = cfg.webhookSecret
    ? await verifyWebhookHmac(raw, hmac, cfg.webhookSecret)
    : false;
  if (!valid) return new Response('invalid hmac', {status: 401});

  let payload: {admin_graphql_api_id?: string} | null = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('ok', {status: 200});
  }
  const gid = payload?.admin_graphql_api_id;
  if (!gid) return new Response('ok', {status: 200});

  try {
    const order = await loadOrderForLabelEmail(cfg, gid);
    if (order && order.labelUrl && !order.alreadyEmailed && order.email) {
      const origin = new URL(request.url).origin;
      const sent = await sendLabelReadyEmail(cfg, {
        orderName: order.name,
        name: order.firstName ?? '',
        email: order.email,
        labelUrl: order.labelUrl,
        statusUrl: `${origin}${STATUS_PATH}`,
      });
      if (sent.ok) await markLabelEmailed(cfg, gid);
    }
  } catch (err) {
    console.error('[widerruf] webhook handler failed', err);
  }

  return new Response('ok', {status: 200});
}
