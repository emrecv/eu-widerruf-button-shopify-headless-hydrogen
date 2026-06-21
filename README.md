# hydrogen-widerruf

Drop-in **Widerruf** (EU-Widerrufsrecht) für Shopify-Hydrogen-Storefronts:
eigenständig gestaltete Widerruf-Seite, Kunden-Status-Dashboard, Rücksendeschein-Flow
und transaktionale E-Mails — verwaltet komplett im **nativen Shopify-Admin**.

Am Ende musst du nur einen Footer-Button zu `/widerruf` setzen.

- **Eigenes Design** (Schwarzweiß, minimalistisch, mobil) — unabhängig vom Host-Theme,
  via CSS-Variablen überschreibbar.
- **Admin-API** über Client-Credentials-Grant einer Dev-Dashboard-App (Token wird
  automatisch geholt und gecacht).
- **Verwaltung im Shopify-Admin**: Widerrufe erscheinen als Bestellungen mit Tag
  `Widerruf` + Notiz. Rücksendeschein-Link wird ins Metafeld `widerruf.label_url`
  eingetragen — der Kunde bekommt automatisch eine Mail.
- **Status-Dashboard** unter `/widerruf/status` (Login per Bestellnummer + PLZ).

## Voraussetzung: Dev-Dashboard-App

1. Im [Shopify Dev Dashboard](https://dev.shopify.com/dashboard/) eine App erstellen.
2. Scopes `read_orders`, `write_orders` setzen und eine Version **releasen**.
3. **Protected Customer Data** aktivieren (für Bestell-E-Mail/PLZ).
4. App **auf deinem Shop installieren**.
5. **Client ID** und **Client Secret** aus den App-Settings notieren.

## Installation

```bash
npm install github:DEIN-USER/hydrogen-widerruf
npx hydrogen-widerruf init
```

`init` fragt die Konfiguration ab, schreibt `.env`, generiert die Route-Dateien
(`widerruf`, `widerruf.status`, `widerruf.webhook`), testet die Verbindung und legt
(best-effort) die Metafeld-Definitionen + den `orders/updated`-Webhook an.

Danach den Footer-Button setzen:

```tsx
import {WiderrufButton} from 'hydrogen-widerruf';
// ...
<WiderrufButton />            // oder: <a href="/widerruf">Vertrag widerrufen</a>
```

Dev-Server neu starten — fertig.

## Umgebungsvariablen

| Variable | Pflicht | Zweck |
| --- | --- | --- |
| `PUBLIC_STORE_DOMAIN` | ✓ | `xxx.myshopify.com` |
| `PRIVATE_ADMIN_CLIENT_ID` | ✓* | Dev-Dashboard Client ID |
| `PRIVATE_ADMIN_CLIENT_SECRET` | ✓* | Dev-Dashboard Client Secret |
| `PRIVATE_ADMIN_API_TOKEN` | – | Alternativer statischer Token (klassische Custom App) |
| `WIDERRUF_BRAND_NAME` | – | Markenname in E-Mails |
| `WIDERRUF_FROM_EMAIL` | – | Absenderadresse (verifizierte Resend-Domain) |
| `RESEND_API_KEY` | – | Für E-Mail-Versand |
| `WITHDRAWAL_NOTIFY_EMAIL` | – | Team-Benachrichtigung |
| `WIDERRUF_LOGO_URL` | – | Logo in E-Mails |
| `WIDERRUF_WEBHOOK_SECRET` | – | HMAC-Secret des Webhooks (Default: Client Secret) |

\* Entweder Client-ID + Secret **oder** `PRIVATE_ADMIN_API_TOKEN`.

> **Produktion:** dieselben Variablen in deiner Hosting-/Oxygen-Umgebung als *secret*
> hinterlegen.

## So verwaltest du Widerrufe (im Shopify-Admin)

1. Neuer Widerruf → Bestellung erhält Tag `Widerruf` + Notiz (+ Team-Mail).
2. Rücksendeschein extern erzeugen (z. B. DHL Retoure).
3. Den Link im Order-Metafeld **`widerruf.label_url`** eintragen → der Kunde bekommt
   automatisch die Rücksendeschein-Mail, das Status-Dashboard zeigt den Download.
4. Erstattung wie gewohnt in Shopify auslösen → Status springt auf „Erstattet".

### Fallback: Metafelder manuell anlegen

Falls `init` die Definitionen nicht anlegen konnte (Berechtigungen/Version), in
**Einstellungen → Benutzerdefinierte Daten → Bestellungen** anlegen (Namespace
`widerruf`): `label_url` (URL), `items` (mehrzeilig), `submitted_at` (Datum/Zeit),
`label_emailed_at` (Datum/Zeit).

## Anpassen des Designs

Das Design wird von den Komponenten automatisch als `<style>` injiziert (kein CSS-Import
nötig). Zum Anpassen die CSS-Variablen auf einem Eltern-Element überschreiben:

```css
.wdr { --wdr-fg: #111; --wdr-radius: 4px; --wdr-maxw: 560px; }
```

## Lizenz

MIT
