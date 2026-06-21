import {readConfig} from '../server/config';
import {checkRateLimit, formatRetryAfter, getClientIP} from '../server/security.server';
import {findOrderForWithdrawal, submitWithdrawalToShopify} from '../server/admin.server';
import {sendConfirmationEmail, sendTeamNotification, type EmailItem} from '../server/email.server';
import type {WiderrufActionData, WiderrufFormValues} from '../types';

interface ActionArgs {
  request: Request;
  context: unknown;
}

/** Pfad des Status-Dashboards (muss zur generierten Status-Route passen). */
const STATUS_PATH = '/widerruf/status';

export const widerrufMeta = () => [
  {title: 'Widerruf erklären'},
  {
    name: 'description',
    content:
      'Widerrufe deinen Vertrag und wähle die betroffenen Produkte deiner Bestellung aus.',
  },
];

function variantOf(variantTitle: string | null): string {
  return variantTitle && variantTitle !== 'Default Title' ? variantTitle : '';
}

export async function widerrufAction({
  request,
  context,
}: ActionArgs): Promise<WiderrufActionData> {
  const env = ((context as {env?: Record<string, unknown>}).env ?? {}) as Record<
    string,
    unknown
  >;
  const cfg = readConfig(env);

  const form = await request.formData();
  const intent = String(form.get('intent') ?? '');
  const values: WiderrufFormValues = {
    email: String(form.get('email') ?? '').trim(),
    firstName: String(form.get('firstName') ?? '').trim(),
    lastName: String(form.get('lastName') ?? '').trim(),
    orderNumber: String(form.get('orderNumber') ?? '').trim(),
  };

  // Schutz gegen das Durchprobieren von Bestellnummern.
  const ip = getClientIP(request);
  const rl = checkRateLimit(`widerruf:${ip}`, 12, 10 * 60 * 1000, 15 * 60 * 1000);
  if (rl.blocked) {
    const retry = rl.retryAfter ? formatRetryAfter(rl.retryAfter) : 'einige Minuten';
    return {
      step: 'lookup',
      error: `Zu viele Versuche. Bitte versuche es in ${retry} erneut.`,
      values,
    };
  }

  if (
    !values.email ||
    !values.firstName ||
    !values.lastName ||
    !values.orderNumber
  ) {
    return {step: 'lookup', error: 'Bitte fülle alle Pflichtfelder aus.', values};
  }

  const lookup = await findOrderForWithdrawal(cfg, {
    orderNumber: values.orderNumber,
    email: values.email,
  });
  if (!lookup.ok) return {step: 'lookup', error: lookup.message, values};

  // Schritt 1 → 2: Artikel zur Auswahl anzeigen.
  if (intent === 'lookup') {
    return {
      step: 'select',
      values,
      orderName: lookup.order.name,
      lineItems: lookup.order.lineItems,
    };
  }

  // Schritt 2: Widerruf absenden.
  if (intent === 'submit') {
    const selectedIds = form.getAll('lineItemId').map(String);
    const confirmed = form.get('confirm') === 'on';
    const reason = String(form.get('reason') ?? '').trim();
    const selected = lookup.order.lineItems.filter((li) =>
      selectedIds.includes(li.id),
    );

    const back = (error: string): WiderrufActionData => ({
      step: 'select',
      values,
      orderName: lookup.order.name,
      lineItems: lookup.order.lineItems,
      error,
    });

    if (selected.length === 0) {
      return back('Bitte wähle mindestens ein Produkt aus, das du widerrufen möchtest.');
    }
    if (!confirmed) {
      return back('Bitte bestätige die Widerrufserklärung, um fortzufahren.');
    }

    const emailItems: EmailItem[] = selected.map((li) => ({
      title: li.title,
      variant: li.variantTitle,
      quantity: li.quantity,
      imageUrl: li.imageUrl,
    }));
    const itemsText = selected
      .map((li) => {
        const v = variantOf(li.variantTitle);
        return `- ${li.title}${v ? ` (${v})` : ''} ×${li.quantity}`;
      })
      .join('\n');

    const fullName = `${values.firstName} ${values.lastName}`.trim();
    const submittedAt = new Date().toLocaleString('de-DE', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'Europe/Berlin',
    });

    const result = await submitWithdrawalToShopify(cfg, {
      orderNumber: values.orderNumber,
      email: values.email,
      name: fullName,
      items: itemsText,
      reason: reason || undefined,
      submittedAt,
    });
    if (!result.ok) return back(result.message);

    // E-Mails sind nicht erfolgskritisch — Fehler nur loggen.
    const origin = new URL(request.url).origin;
    const statusUrl = `${origin}${STATUS_PATH}`;

    await sendConfirmationEmail(cfg, {
      orderName: result.orderName,
      name: fullName,
      email: values.email,
      submittedAt,
      items: emailItems,
      reason: reason || undefined,
      statusUrl,
    }).catch(() => undefined);

    if (cfg.teamEmail) {
      const numericId = lookup.order.id.split('/').pop();
      await sendTeamNotification(cfg, {
        to: cfg.teamEmail,
        orderName: result.orderName,
        name: fullName,
        email: values.email,
        submittedAt,
        items: emailItems,
        reason: reason || undefined,
        adminOrderUrl:
          numericId && cfg.storeDomain
            ? `https://${cfg.storeDomain}/admin/orders/${numericId}`
            : undefined,
      }).catch(() => undefined);
    }

    return {step: 'done', orderName: result.orderName, statusPath: STATUS_PATH};
  }

  return {step: 'lookup', error: 'Ungültige Anfrage.', values};
}
