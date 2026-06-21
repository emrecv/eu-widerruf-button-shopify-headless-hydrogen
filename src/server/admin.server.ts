/**
 * Minimaler Shopify-Admin-GraphQL-Client für den Widerruf-Flow.
 *
 * Holt den Admin-Token bevorzugt über den Client-Credentials-Grant einer
 * Dev-Dashboard-App (gültig 24 h, prozessweit gecacht) und fällt auf einen
 * statischen Custom-App-Token zurück. Alle Funktionen nehmen die `WiderrufConfig`
 * und lösen den Token intern auf — die Routen bleiben dadurch schlank.
 */

import {ADMIN_API_VERSION, type WiderrufConfig} from './config';

// ── GraphQL-Transport ──────────────────────────────────────────────────────────

interface AdminGraphqlResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function extractGraphqlError(errors: unknown): string {
  if (typeof errors === 'string') return errors;
  if (Array.isArray(errors)) {
    const parts = errors
      .map((e) => {
        const message =
          e && typeof e === 'object' && 'message' in e
            ? String((e as {message: unknown}).message)
            : String(e);
        const code =
          e &&
          typeof e === 'object' &&
          'extensions' in e &&
          (e as {extensions?: {code?: unknown}}).extensions?.code;
        return code ? `${message} (${String(code)})` : message;
      })
      .filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  return 'Unbekannter Admin-API-Fehler';
}

async function adminGraphql<T = unknown>(
  storeDomain: string,
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<AdminGraphqlResult<T>> {
  try {
    const url = `https://${storeDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Shopify-Access-Token': token},
      body: JSON.stringify({query, variables}),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[widerruf] Admin API HTTP error', res.status, body);
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: `Admin API ${res.status}: Token ungültig oder ohne Berechtigung. ${body}`.trim(),
        };
      }
      return {ok: false, error: `Admin API ${res.status}: ${body}`.trim()};
    }

    const json = (await res.json()) as {data?: T; errors?: unknown};
    if (json.errors) {
      console.error('[widerruf] Admin API GraphQL errors', JSON.stringify(json.errors));
      return {ok: false, error: extractGraphqlError(json.errors)};
    }
    return {ok: true, data: json.data};
  } catch (err) {
    console.error('[widerruf] Admin API fetch failed', err);
    return {ok: false, error: String(err)};
  }
}

// ── Token-Beschaffung (Client-Credentials-Grant, gecacht) ────────────────────────

interface CachedAdminToken {
  token: string;
  expiresAt: number;
}

function getTokenCache(): Map<string, CachedAdminToken> {
  const g = globalThis as Record<string, unknown>;
  if (!g.__WIDERRUF_ADMIN_TOKEN_CACHE) g.__WIDERRUF_ADMIN_TOKEN_CACHE = new Map();
  return g.__WIDERRUF_ADMIN_TOKEN_CACHE as Map<string, CachedAdminToken>;
}

async function fetchTokenViaClientCredentials(
  storeDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<{ok: true; token: string} | {ok: false; error: string}> {
  const cache = getTokenCache();
  const cached = cache.get(storeDomain);
  if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
    return {ok: true, token: cached.token};
  }
  try {
    const res = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[widerruf] client_credentials HTTP error', res.status, body);
      return {ok: false, error: `Token-Abruf fehlgeschlagen (${res.status})`};
    }
    const json = (await res.json()) as {access_token?: string; expires_in?: number};
    if (!json.access_token) return {ok: false, error: 'Kein Access-Token erhalten.'};
    const ttlMs = (json.expires_in ?? 86399) * 1000;
    cache.set(storeDomain, {token: json.access_token, expiresAt: Date.now() + ttlMs});
    return {ok: true, token: json.access_token};
  } catch (err) {
    console.error('[widerruf] client_credentials fetch failed', err);
    return {ok: false, error: String(err)};
  }
}

export async function resolveAdminToken(
  cfg: WiderrufConfig,
): Promise<{ok: true; token: string} | {ok: false; error: string}> {
  if (!cfg.storeDomain) return {ok: false, error: 'PUBLIC_STORE_DOMAIN fehlt.'};
  if (cfg.clientId && cfg.clientSecret) {
    return fetchTokenViaClientCredentials(cfg.storeDomain, cfg.clientId, cfg.clientSecret);
  }
  if (cfg.staticToken) return {ok: true, token: cfg.staticToken};
  return {ok: false, error: 'Admin-API nicht konfiguriert (Client-Credentials oder Token).'};
}

/** Löst den Token auf und führt eine GraphQL-Operation aus. */
async function run<T>(
  cfg: WiderrufConfig,
  query: string,
  variables?: Record<string, unknown>,
): Promise<AdminGraphqlResult<T>> {
  const t = await resolveAdminToken(cfg);
  if (!t.ok) return {ok: false, error: t.error};
  return adminGraphql<T>(cfg.storeDomain as string, t.token, query, variables);
}

function normalizeOrderNumber(raw: string): string {
  return raw.trim().replace(/^#/, '');
}

const SERVICE_UNAVAILABLE =
  'Der Widerruf-Service ist derzeit nicht verfügbar. Bitte kontaktiere uns direkt.';
const NOT_FOUND =
  'Wir konnten keine Bestellung mit diesen Angaben finden. Bitte prüfe deine Eingaben.';

// ── Bestellung + Artikel laden (Schritt 1 des Formulars) ─────────────────────────

export interface WithdrawalLineItem {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  imageUrl: string | null;
  price: {amount: string; currencyCode: string} | null;
}

interface OrderWithItemsNode {
  id: string;
  name: string;
  email: string | null;
  lineItems: {
    nodes: Array<{
      id: string;
      title: string;
      variantTitle: string | null;
      quantity: number;
      image: {url: string} | null;
      originalUnitPriceSet: {shopMoney: {amount: string; currencyCode: string}} | null;
    }>;
  };
}

const FIND_ORDER_WITH_ITEMS = `#graphql
  query FindOrderWithItems($query: String!) {
    orders(first: 10, query: $query) {
      nodes {
        id
        name
        email
        lineItems(first: 50) {
          nodes {
            id
            title
            variantTitle
            quantity
            image { url }
            originalUnitPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }
    }
  }
`;

export type FindOrderResult =
  | {ok: true; order: {id: string; name: string; lineItems: WithdrawalLineItem[]}}
  | {ok: false; message: string};

export async function findOrderForWithdrawal(
  cfg: WiderrufConfig,
  params: {orderNumber: string; email: string},
): Promise<FindOrderResult> {
  const orderNumber = normalizeOrderNumber(params.orderNumber);
  const find = await run<{orders: {nodes: OrderWithItemsNode[]}}>(cfg, FIND_ORDER_WITH_ITEMS, {
    query: `name:#${orderNumber}`,
  });
  if (!find.ok) return {ok: false, message: find.error ?? SERVICE_UNAVAILABLE};

  const entered = params.email.trim().toLowerCase();
  const order = find.data?.orders.nodes.find(
    (n) => (n.email ?? '').trim().toLowerCase() === entered,
  );
  if (!order) return {ok: false, message: NOT_FOUND};

  return {
    ok: true,
    order: {
      id: order.id,
      name: order.name,
      lineItems: order.lineItems.nodes.map((li) => ({
        id: li.id,
        title: li.title,
        variantTitle: li.variantTitle,
        quantity: li.quantity,
        imageUrl: li.image?.url ?? null,
        price: li.originalUnitPriceSet?.shopMoney ?? null,
      })),
    },
  };
}

// ── Widerruf absenden: Notiz + Tag + Metafelder ──────────────────────────────────

export interface WithdrawalInput {
  orderNumber: string;
  email: string;
  name: string;
  items: string;
  reason?: string;
  submittedAt: string;
}

interface FoundOrder {
  id: string;
  name: string;
  email: string | null;
  note: string | null;
  tags: string[];
}

const FIND_ORDER = `#graphql
  query FindOrder($query: String!) {
    orders(first: 10, query: $query) {
      nodes { id name email note tags }
    }
  }
`;

const ORDER_UPDATE = `#graphql
  mutation WiderrufOrderUpdate($input: OrderInput!) {
    orderUpdate(input: $input) {
      order { id }
      userErrors { field message }
    }
  }
`;

const METAFIELDS_SET = `#graphql
  mutation WiderrufMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

function buildNote(data: WithdrawalInput): string {
  const lines = [
    `▌ WIDERRUF eingegangen — ${data.submittedAt}`,
    `Name: ${data.name}`,
    `E-Mail: ${data.email}`,
    `Betroffene Ware: ${data.items}`,
  ];
  if (data.reason) lines.push(`Begründung (freiwillig): ${data.reason}`);
  return lines.join('\n');
}

export type SubmitResult =
  | {ok: true; orderName: string}
  | {ok: false; message: string};

export async function submitWithdrawalToShopify(
  cfg: WiderrufConfig,
  data: WithdrawalInput,
): Promise<SubmitResult> {
  const orderNumber = normalizeOrderNumber(data.orderNumber);
  const find = await run<{orders: {nodes: FoundOrder[]}}>(cfg, FIND_ORDER, {
    query: `name:#${orderNumber}`,
  });
  if (!find.ok) return {ok: false, message: find.error ?? SERVICE_UNAVAILABLE};

  const entered = data.email.trim().toLowerCase();
  const order = find.data?.orders.nodes.find(
    (n) => (n.email ?? '').trim().toLowerCase() === entered,
  );
  if (!order) return {ok: false, message: NOT_FOUND};

  const note = order.note ? `${order.note}\n\n${buildNote(data)}` : buildNote(data);
  const tags = Array.from(new Set([...(order.tags ?? []), 'Widerruf']));

  const update = await run<{
    orderUpdate: {userErrors: Array<{field: string[]; message: string}>};
  }>(cfg, ORDER_UPDATE, {input: {id: order.id, note, tags}});

  if (!update.ok) return {ok: false, message: update.error ?? SERVICE_UNAVAILABLE};
  const errs = update.data?.orderUpdate.userErrors ?? [];
  if (errs.length) {
    console.error('[widerruf] orderUpdate userErrors', JSON.stringify(errs));
    return {ok: false, message: 'Der Widerruf konnte nicht gespeichert werden.'};
  }

  // Best-effort: gewählte Artikel + Zeitpunkt als Metafelder (für das Status-Dashboard).
  await run(cfg, METAFIELDS_SET, {
    metafields: [
      {ownerId: order.id, namespace: 'widerruf', key: 'items', type: 'multi_line_text_field', value: data.items},
      {ownerId: order.id, namespace: 'widerruf', key: 'submitted_at', type: 'date_time', value: new Date().toISOString()},
    ],
  }).catch(() => undefined);

  return {ok: true, orderName: order.name};
}

// ── Status-Dashboard (Bestellnummer + PLZ) ───────────────────────────────────────

export type WithdrawalStatus = 'received' | 'label_ready' | 'refunded';

interface StatusNode {
  id: string;
  name: string;
  tags: string[];
  displayFinancialStatus: string | null;
  shippingAddress: {zip: string | null} | null;
  labelUrl: {value: string} | null;
  items: {value: string} | null;
  refunds: Array<{id: string}>;
}

const STATUS_QUERY = `#graphql
  query WiderrufStatus($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        id
        name
        tags
        displayFinancialStatus
        shippingAddress { zip }
        labelUrl: metafield(namespace: "widerruf", key: "label_url") { value }
        items: metafield(namespace: "widerruf", key: "items") { value }
        refunds(first: 5) { id }
      }
    }
  }
`;

export type StatusResult =
  | {
      ok: true;
      orderName: string;
      status: WithdrawalStatus;
      items: string | null;
      labelUrl: string | null;
    }
  | {ok: false; message: string};

function deriveStatus(node: StatusNode): WithdrawalStatus {
  const financial = (node.displayFinancialStatus ?? '').toUpperCase();
  if (financial.includes('REFUNDED') || node.refunds.length > 0) return 'refunded';
  if (node.labelUrl?.value) return 'label_ready';
  return 'received';
}

function normalizeZip(zip: string): string {
  return zip.replace(/\s+/g, '').toLowerCase();
}

export async function getWithdrawalStatus(
  cfg: WiderrufConfig,
  params: {orderNumber: string; zip: string},
): Promise<StatusResult> {
  const orderNumber = normalizeOrderNumber(params.orderNumber);
  const find = await run<{orders: {nodes: StatusNode[]}}>(cfg, STATUS_QUERY, {
    query: `name:#${orderNumber}`,
  });
  if (!find.ok) return {ok: false, message: find.error ?? SERVICE_UNAVAILABLE};

  const enteredZip = normalizeZip(params.zip);
  const order = find.data?.orders.nodes.find(
    (n) => normalizeZip(n.shippingAddress?.zip ?? '') === enteredZip && enteredZip.length > 0,
  );
  if (!order) return {ok: false, message: NOT_FOUND};

  // Nur Bestellungen anzeigen, zu denen tatsächlich ein Widerruf vorliegt.
  if (!(order.tags ?? []).includes('Widerruf')) {
    return {ok: false, message: 'Zu dieser Bestellung liegt kein Widerruf vor.'};
  }

  return {
    ok: true,
    orderName: order.name,
    status: deriveStatus(order),
    items: order.items?.value ?? null,
    labelUrl: order.labelUrl?.value ?? null,
  };
}

// ── Widerruf zurückziehen (vom Status-Dashboard) ─────────────────────────────────

interface CancelNode {
  id: string;
  name: string;
  email: string | null;
  note: string | null;
  tags: string[];
  displayFinancialStatus: string | null;
  shippingAddress: {zip: string | null} | null;
  customer: {firstName: string | null} | null;
  labelUrl: {value: string} | null;
  refunds: Array<{id: string}>;
}

const CANCEL_QUERY = `#graphql
  query WiderrufCancel($query: String!) {
    orders(first: 5, query: $query) {
      nodes {
        id
        name
        email
        note
        tags
        displayFinancialStatus
        shippingAddress { zip }
        customer { firstName }
        labelUrl: metafield(namespace: "widerruf", key: "label_url") { value }
        refunds(first: 5) { id }
      }
    }
  }
`;

export type CancelResult =
  | {ok: true; orderName: string; email: string | null; firstName: string | null}
  | {ok: false; message: string};

/**
 * Zieht einen Widerruf zurück: entfernt den Tag „Widerruf" und vermerkt das in der
 * Notiz. Nur möglich, solange noch kein Rücksendeschein hinterlegt und nichts erstattet
 * wurde — danach läuft die Bearbeitung bereits und der Kunde muss uns kontaktieren.
 */
export async function cancelWithdrawal(
  cfg: WiderrufConfig,
  params: {orderNumber: string; zip: string},
): Promise<CancelResult> {
  const orderNumber = normalizeOrderNumber(params.orderNumber);
  const find = await run<{orders: {nodes: CancelNode[]}}>(cfg, CANCEL_QUERY, {
    query: `name:#${orderNumber}`,
  });
  if (!find.ok) return {ok: false, message: find.error ?? SERVICE_UNAVAILABLE};

  const enteredZip = normalizeZip(params.zip);
  const order = find.data?.orders.nodes.find(
    (n) => normalizeZip(n.shippingAddress?.zip ?? '') === enteredZip && enteredZip.length > 0,
  );
  if (!order) return {ok: false, message: NOT_FOUND};

  if (!(order.tags ?? []).includes('Widerruf')) {
    return {ok: false, message: 'Zu dieser Bestellung liegt kein aktiver Widerruf vor.'};
  }

  const financial = (order.displayFinancialStatus ?? '').toUpperCase();
  const inProgress =
    financial.includes('REFUNDED') || order.refunds.length > 0 || Boolean(order.labelUrl?.value);
  if (inProgress) {
    return {
      ok: false,
      message:
        'Dein Widerruf ist bereits in Bearbeitung und kann nicht mehr zurückgezogen werden. Bitte kontaktiere uns.',
    };
  }

  const stamp = new Date().toLocaleString('de-DE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Berlin',
  });
  const note = order.note
    ? `${order.note}\n\n▌ WIDERRUF ZURÜCKGEZOGEN — ${stamp}`
    : `▌ WIDERRUF ZURÜCKGEZOGEN — ${stamp}`;
  const tags = (order.tags ?? []).filter((t) => t !== 'Widerruf');

  const update = await run<{
    orderUpdate: {userErrors: Array<{field: string[]; message: string}>};
  }>(cfg, ORDER_UPDATE, {input: {id: order.id, note, tags}});
  if (!update.ok) return {ok: false, message: update.error ?? SERVICE_UNAVAILABLE};
  const errs = update.data?.orderUpdate.userErrors ?? [];
  if (errs.length) {
    console.error('[widerruf] cancel orderUpdate userErrors', JSON.stringify(errs));
    return {ok: false, message: 'Der Widerruf konnte nicht zurückgezogen werden.'};
  }

  return {ok: true, orderName: order.name, email: order.email, firstName: order.customer?.firstName ?? null};
}

// ── Webhook: Rücksendeschein-Mail auslösen ───────────────────────────────────────

interface LabelOrderNode {
  id: string;
  name: string;
  email: string | null;
  customer: {firstName: string | null} | null;
  labelUrl: {value: string} | null;
  labelEmailedAt: {value: string} | null;
  items: {value: string} | null;
}

const LABEL_ORDER_QUERY = `#graphql
  query WiderrufLabelOrder($id: ID!) {
    order(id: $id) {
      id
      name
      email
      customer { firstName }
      labelUrl: metafield(namespace: "widerruf", key: "label_url") { value }
      labelEmailedAt: metafield(namespace: "widerruf", key: "label_emailed_at") { value }
      items: metafield(namespace: "widerruf", key: "items") { value }
    }
  }
`;

export interface LabelOrderState {
  id: string;
  name: string;
  email: string | null;
  firstName: string | null;
  labelUrl: string | null;
  alreadyEmailed: boolean;
  items: string | null;
}

export async function loadOrderForLabelEmail(
  cfg: WiderrufConfig,
  orderGid: string,
): Promise<LabelOrderState | null> {
  const res = await run<{order: LabelOrderNode | null}>(cfg, LABEL_ORDER_QUERY, {id: orderGid});
  if (!res.ok || !res.data?.order) return null;
  const o = res.data.order;
  return {
    id: o.id,
    name: o.name,
    email: o.email,
    firstName: o.customer?.firstName ?? null,
    labelUrl: o.labelUrl?.value ?? null,
    alreadyEmailed: Boolean(o.labelEmailedAt?.value),
    items: o.items?.value ?? null,
  };
}

export async function markLabelEmailed(cfg: WiderrufConfig, orderGid: string): Promise<void> {
  await run(cfg, METAFIELDS_SET, {
    metafields: [
      {
        ownerId: orderGid,
        namespace: 'widerruf',
        key: 'label_emailed_at',
        type: 'date_time',
        value: new Date().toISOString(),
      },
    ],
  }).catch(() => undefined);
}
