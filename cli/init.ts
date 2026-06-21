#!/usr/bin/env node
/**
 * `npx hydrogen-widerruf init`
 *
 * Interaktives Setup: fragt die Konfiguration ab, schreibt sie nach .env, generiert
 * die Route-Stubs in app/routes, testet die Admin-API-Verbindung und legt (best-effort)
 * Metafeld-Definitionen + den orders/updated-Webhook an. Am Ende kommt der Footer-Snippet.
 */

import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import {readdir} from 'node:fs/promises';
import path from 'node:path';

const ADMIN_API_VERSION = '2025-07';
const CWD = process.cwd();
const ENV_PATH = path.join(CWD, '.env');
const ROUTES_DIR = path.join(CWD, 'app', 'routes');

const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

const rl = createInterface({input, output});

async function ask(question: string, fallback = ''): Promise<string> {
  const suffix = fallback ? c.dim(` (${fallback})`) : '';
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer || fallback;
}

// ── .env lesen/schreiben (andere Einträge bleiben erhalten) ───────────────────────

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function upsertEnv(text: string, updates: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(updates)) {
    if (!value) continue;
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    result = re.test(result) ? result.replace(re, line) : `${result.trimEnd()}\n${line}\n`;
  }
  return result.startsWith('\n') ? result.slice(1) : result;
}

// ── Shopify Admin API ─────────────────────────────────────────────────────────────

async function getToken(domain: string, id: string, secret: string): Promise<string> {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({grant_type: 'client_credentials', client_id: id, client_secret: secret}),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Token-Abruf fehlgeschlagen (${res.status}). ${body.includes('app_not_installed') ? 'Die App ist nicht auf dem Shop installiert.' : body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {access_token?: string};
  if (!json.access_token) throw new Error('Kein Access-Token erhalten.');
  return json.access_token;
}

async function adminGraphql(domain: string, token: string, query: string, variables?: unknown) {
  const res = await fetch(`https://${domain}/admin/api/${ADMIN_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'X-Shopify-Access-Token': token},
    body: JSON.stringify({query, variables}),
  });
  const json = (await res.json()) as {data?: any; errors?: any};
  return json;
}

const METAFIELD_DEFS = [
  {key: 'label_url', name: 'Widerruf — Rücksendeschein (URL)', type: 'url', description: 'Link/PDF des Rücksendescheins. Sobald gesetzt, erhält der Kunde automatisch eine E-Mail.'},
  {key: 'items', name: 'Widerruf — betroffene Artikel', type: 'multi_line_text_field', description: 'Vom Kunden gewählte Artikel.'},
  {key: 'submitted_at', name: 'Widerruf — eingegangen am', type: 'date_time', description: 'Zeitpunkt des Widerrufseingangs.'},
  {key: 'label_emailed_at', name: 'Widerruf — Label gemailt am', type: 'date_time', description: 'Interne Idempotenz-Markierung.'},
];

const DEF_MUTATION = `
  mutation CreateDef($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id }
      userErrors { field message code }
    }
  }`;

async function createMetafieldDefs(domain: string, token: string) {
  for (const def of METAFIELD_DEFS) {
    try {
      const json = await adminGraphql(domain, token, DEF_MUTATION, {
        definition: {
          name: def.name,
          namespace: 'widerruf',
          key: def.key,
          type: def.type,
          description: def.description,
          ownerType: 'ORDER',
          access: {admin: 'MERCHANT_READ_WRITE'},
        },
      });
      const errs = json.data?.metafieldDefinitionCreate?.userErrors ?? json.errors ?? [];
      const taken = Array.isArray(errs) && errs.some((e: any) => String(e.code) === 'TAKEN');
      if (taken) console.log(`   ${c.dim(`• widerruf.${def.key} existiert bereits`)}`);
      else if (errs.length) console.log(`   ${c.yellow(`• widerruf.${def.key}: ${JSON.stringify(errs)}`)}`);
      else console.log(`   ${c.green('•')} widerruf.${def.key}`);
    } catch (err) {
      console.log(`   ${c.yellow(`• widerruf.${def.key} übersprungen: ${String(err)}`)}`);
    }
  }
}

const WEBHOOK_MUTATION = `
  mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }`;

async function createWebhook(domain: string, token: string, callbackUrl: string) {
  try {
    const json = await adminGraphql(domain, token, WEBHOOK_MUTATION, {
      topic: 'ORDERS_UPDATED',
      sub: {callbackUrl, format: 'JSON'},
    });
    const errs = json.data?.webhookSubscriptionCreate?.userErrors ?? json.errors ?? [];
    const taken = Array.isArray(errs) && errs.some((e: any) => /taken|exists/i.test(String(e.message)));
    if (taken) console.log(`   ${c.dim('• Webhook existiert bereits')}`);
    else if (errs.length) console.log(`   ${c.yellow(`• Webhook: ${JSON.stringify(errs)}`)}`);
    else console.log(`   ${c.green('•')} orders/updated → ${callbackUrl}`);
  } catch (err) {
    console.log(`   ${c.yellow(`• Webhook übersprungen: ${String(err)}`)}`);
  }
}

// ── Route-Stubs ───────────────────────────────────────────────────────────────────

async function detectLocalePrefix(): Promise<string> {
  try {
    const files = await readdir(ROUTES_DIR);
    return files.some((f) => f.startsWith('($locale)')) ? '($locale).' : '';
  } catch {
    return '';
  }
}

function stub(component: string, action: string, meta: string): string {
  // Styles werden von der Komponente selbst als <style> injiziert — kein CSS-Import nötig.
  const lines = [
    `import {${component}} from 'hydrogen-widerruf';`,
    `export {${action} as action${meta ? `, ${meta} as meta` : ''}} from 'hydrogen-widerruf/server';`,
    `export default ${component};`,
  ];
  return lines.join('\n') + '\n';
}

async function writeStub(file: string, content: string) {
  if (existsSync(file)) {
    console.log(`   ${c.dim(`• ${path.relative(CWD, file)} existiert bereits — übersprungen`)}`);
    return;
  }
  await writeFile(file, content, 'utf8');
  console.log(`   ${c.green('•')} ${path.relative(CWD, file)}`);
}

// ── Hauptablauf ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${c.bold('hydrogen-widerruf — Setup')}\n`);

  if (!existsSync(ROUTES_DIR)) {
    console.log(c.yellow(`Warnung: ${path.relative(CWD, ROUTES_DIR)} nicht gefunden. Bist du im Hydrogen-Projekt-Root?`));
  }

  const existingEnv = existsSync(ENV_PATH) ? parseEnv(await readFile(ENV_PATH, 'utf8')) : {};

  console.log(c.dim('Lass die Felder leer, um den vorhandenen Wert zu behalten.\n'));
  const cfg = {
    PUBLIC_STORE_DOMAIN: await ask('Shop-Domain (xxx.myshopify.com)', existingEnv.PUBLIC_STORE_DOMAIN ?? ''),
    PRIVATE_ADMIN_CLIENT_ID: await ask('Dev-Dashboard Client ID', existingEnv.PRIVATE_ADMIN_CLIENT_ID ?? ''),
    PRIVATE_ADMIN_CLIENT_SECRET: await ask('Dev-Dashboard Client Secret', existingEnv.PRIVATE_ADMIN_CLIENT_SECRET ?? ''),
    WIDERRUF_BRAND_NAME: await ask('Marken-/Shopname (für E-Mails)', existingEnv.WIDERRUF_BRAND_NAME ?? ''),
    WIDERRUF_FROM_EMAIL: await ask('Absender-E-Mail (verifizierte Resend-Domain)', existingEnv.WIDERRUF_FROM_EMAIL ?? ''),
    RESEND_API_KEY: await ask('Resend API Key (optional)', existingEnv.RESEND_API_KEY ?? ''),
    WITHDRAWAL_NOTIFY_EMAIL: await ask('Team-Benachrichtigungs-E-Mail (optional)', existingEnv.WITHDRAWAL_NOTIFY_EMAIL ?? ''),
    WIDERRUF_LOGO_URL: await ask('Logo-URL für E-Mails (optional)', existingEnv.WIDERRUF_LOGO_URL ?? ''),
  };
  const publicUrl = (await ask('Öffentliche Storefront-URL (für den Webhook, z. B. https://deinshop.com)', '')).replace(/\/$/, '');

  // 1) .env schreiben
  const envText = existsSync(ENV_PATH) ? await readFile(ENV_PATH, 'utf8') : '';
  await writeFile(ENV_PATH, upsertEnv(envText, cfg), 'utf8');
  console.log(`\n${c.green('✓')} .env aktualisiert`);

  // 2) Route-Stubs
  console.log('\nRoute-Dateien:');
  await mkdir(ROUTES_DIR, {recursive: true});
  const prefix = await detectLocalePrefix();
  await writeStub(path.join(ROUTES_DIR, `${prefix}widerruf.tsx`), stub('WiderrufPage', 'widerrufAction', 'widerrufMeta'));
  // Trailing underscore (`widerruf_`) bricht das Nesting unter /widerruf auf,
  // damit /widerruf/status eine eigenständige Seite ist statt das Formular zu rendern.
  await writeStub(path.join(ROUTES_DIR, `${prefix}widerruf_.status.tsx`), stub('WiderrufStatusPage', 'widerrufStatusAction', 'widerrufStatusMeta'));
  await writeStub(
    path.join(ROUTES_DIR, `widerruf.webhook.tsx`),
    `export {widerrufWebhookAction as action} from 'hydrogen-widerruf/server';\n`,
  );

  // 3) Verbindungstest + Admin-Objekte
  if (cfg.PUBLIC_STORE_DOMAIN && cfg.PRIVATE_ADMIN_CLIENT_ID && cfg.PRIVATE_ADMIN_CLIENT_SECRET) {
    console.log('\nVerbindungstest:');
    try {
      const token = await getToken(cfg.PUBLIC_STORE_DOMAIN, cfg.PRIVATE_ADMIN_CLIENT_ID, cfg.PRIVATE_ADMIN_CLIENT_SECRET);
      const probe = await adminGraphql(cfg.PUBLIC_STORE_DOMAIN, token, 'query { orders(first: 1) { nodes { id name } } }');
      if (probe.errors) {
        console.log(`   ${c.red('✗')} Admin-API: ${JSON.stringify(probe.errors)}`);
        console.log(c.yellow('   → Scopes read_orders/write_orders + Protected Customer Data prüfen.'));
      } else {
        console.log(`   ${c.green('✓')} Token + Bestellzugriff OK`);
        console.log('\nMetafeld-Definitionen:');
        await createMetafieldDefs(cfg.PUBLIC_STORE_DOMAIN, token);
        if (publicUrl) {
          console.log('\nWebhook:');
          await createWebhook(cfg.PUBLIC_STORE_DOMAIN, token, `${publicUrl}/widerruf/webhook`);
        } else {
          console.log(`\n${c.yellow('Webhook übersprungen')} — keine öffentliche URL angegeben.`);
        }
      }
    } catch (err) {
      console.log(`   ${c.red('✗')} ${String(err)}`);
    }
  } else {
    console.log(`\n${c.yellow('Verbindungstest übersprungen')} — Domain/Client-ID/Secret unvollständig.`);
  }

  // 4) Footer-Snippet
  console.log(`\n${c.bold('Fast fertig!')} Füge den Button in deinen Footer ein:\n`);
  console.log(c.dim("  import {WiderrufButton} from 'hydrogen-widerruf';"));
  console.log(c.dim('  <WiderrufButton />'));
  console.log(c.dim('  // oder schlicht:  <a href="/widerruf">Vertrag widerrufen</a>\n'));
  console.log('Danach Dev-Server neu starten (npm run dev) — fertig.\n');

  rl.close();
}

main().catch((err) => {
  console.error(c.red(`\nFehler: ${String(err)}`));
  rl.close();
  process.exit(1);
});
