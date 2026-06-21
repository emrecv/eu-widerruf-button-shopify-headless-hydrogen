import {readConfig} from '../server/config';
import {checkRateLimit, formatRetryAfter, getClientIP} from '../server/security.server';
import {getWithdrawalStatus} from '../server/admin.server';
import type {WiderrufStatusData, WiderrufStatusValues} from '../types';

interface ActionArgs {
  request: Request;
  context: unknown;
}

export const widerrufStatusMeta = () => [
  {title: 'Widerruf-Status'},
  {name: 'description', content: 'Sieh den aktuellen Status deines Widerrufs ein.'},
];

export async function widerrufStatusAction({
  request,
  context,
}: ActionArgs): Promise<WiderrufStatusData> {
  const env = ((context as {env?: Record<string, unknown>}).env ?? {}) as Record<
    string,
    unknown
  >;
  const cfg = readConfig(env);

  const form = await request.formData();
  const values: WiderrufStatusValues = {
    orderNumber: String(form.get('orderNumber') ?? '').trim(),
    zip: String(form.get('zip') ?? '').trim(),
  };

  const ip = getClientIP(request);
  const rl = checkRateLimit(`widerruf-status:${ip}`, 15, 10 * 60 * 1000, 15 * 60 * 1000);
  if (rl.blocked) {
    const retry = rl.retryAfter ? formatRetryAfter(rl.retryAfter) : 'einige Minuten';
    return {
      state: 'form',
      error: `Zu viele Versuche. Bitte versuche es in ${retry} erneut.`,
      values,
    };
  }

  if (!values.orderNumber || !values.zip) {
    return {state: 'form', error: 'Bitte Bestellnummer und PLZ eingeben.', values};
  }

  const res = await getWithdrawalStatus(cfg, {
    orderNumber: values.orderNumber,
    zip: values.zip,
  });
  if (!res.ok) return {state: 'form', error: res.message, values};

  return {
    state: 'result',
    orderName: res.orderName,
    status: res.status,
    items: res.items,
    labelUrl: res.labelUrl,
  };
}
