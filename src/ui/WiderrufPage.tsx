import {Form, useActionData, useNavigation} from 'react-router';
import type {WiderrufActionData, WiderrufFormValues} from '../types';
import type {WithdrawalLineItem} from '../server/admin.server';

const EMPTY: WiderrufFormValues = {
  email: '',
  firstName: '',
  lastName: '',
  orderNumber: '',
};

function formatMoney(price: WithdrawalLineItem['price']): string {
  if (!price) return '';
  try {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: price.currencyCode,
    }).format(Number(price.amount));
  } catch {
    return `${price.amount} ${price.currencyCode}`;
  }
}

function ErrorNote({children}: {children: React.ReactNode}) {
  return <p className="wdr-error">{children}</p>;
}

export function WiderrufPage() {
  const data = useActionData() as WiderrufActionData | undefined;
  const nav = useNavigation();
  const busy = nav.state !== 'idle';

  // ── Erfolg ────────────────────────────────────────────────────────────────
  if (data?.step === 'done') {
    return (
      <div className="wdr">
        <div className="wdr-success-icon" aria-hidden>
          ✓
        </div>
        <h1 className="wdr-h1">Widerruf eingegangen</h1>
        <p className="wdr-lead">
          Vielen Dank — wir haben deinen Widerruf zur Bestellung{' '}
          <strong>{data.orderName}</strong> erhalten. Eine Eingangsbestätigung ist
          unterwegs. Wir senden dir in Kürze einen Rücksendeschein.
        </p>
        <a className="wdr-btn" href={data.statusPath}>
          Status ansehen
        </a>
      </div>
    );
  }

  // ── Produktauswahl ──────────────────────────────────────────────────────────
  if (data?.step === 'select') {
    const {values, orderName, lineItems, error} = data;
    return (
      <div className="wdr">
        <h1 className="wdr-h1">Produkte auswählen</h1>
        <p className="wdr-lead">
          Bestellung <strong>{orderName}</strong> gefunden. Wähle die Produkte aus,
          die du widerrufen möchtest.
        </p>

        <Form method="post" className="wdr-form">
          <input type="hidden" name="intent" value="submit" />
          <input type="hidden" name="email" value={values.email} />
          <input type="hidden" name="firstName" value={values.firstName} />
          <input type="hidden" name="lastName" value={values.lastName} />
          <input type="hidden" name="orderNumber" value={values.orderNumber} />

          <ul className="wdr-items">
            {lineItems.map((li) => {
              const variant =
                li.variantTitle && li.variantTitle !== 'Default Title'
                  ? li.variantTitle
                  : null;
              return (
                <li key={li.id} className="wdr-item">
                  <label className="wdr-item__label">
                    <input
                      type="checkbox"
                      name="lineItemId"
                      value={li.id}
                      defaultChecked
                      className="wdr-item__check"
                    />
                    {li.imageUrl ? (
                      <img
                        src={li.imageUrl}
                        alt=""
                        className="wdr-item__img"
                        loading="lazy"
                      />
                    ) : (
                      <span className="wdr-item__img" />
                    )}
                    <span className="wdr-item__body">
                      <span className="wdr-item__title">{li.title}</span>
                      <span className="wdr-item__meta">
                        {variant ? `${variant} · ` : ''}Menge: {li.quantity}
                        {li.price ? ` · ${formatMoney(li.price)}` : ''}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="wdr-field">
            <label className="wdr-label" htmlFor="reason">
              Begründung (freiwillig)
            </label>
            <textarea
              id="reason"
              name="reason"
              className="wdr-textarea"
              placeholder="Optional — du musst keinen Grund angeben."
            />
          </div>

          <label className="wdr-check">
            <input type="checkbox" name="confirm" />
            <span>
              Hiermit widerrufe ich den Vertrag über den Kauf der oben ausgewählten
              Waren.
            </span>
          </label>

          {error ? <ErrorNote>{error}</ErrorNote> : null}

          <button type="submit" className="wdr-btn wdr-btn--full" disabled={busy}>
            {busy ? 'Wird gesendet…' : 'Widerruf absenden'}
          </button>

          <a href="/widerruf" className="wdr-link">
            Zurück
          </a>
        </Form>
      </div>
    );
  }

  // ── Daten erfassen (Standard) ───────────────────────────────────────────────
  const values = data?.step === 'lookup' ? data.values : EMPTY;
  const error = data?.step === 'lookup' ? data.error : undefined;

  return (
    <div className="wdr">
      <h1 className="wdr-h1">Widerruf erklären</h1>
      <p className="wdr-lead">
        Gib deine Daten ein, um deine Bestellung zu finden. Anschließend wählst du die
        Produkte aus, die du widerrufen möchtest, und sendest die Erklärung ab.
      </p>

      <Form method="post" className="wdr-form">
        <input type="hidden" name="intent" value="lookup" />

        <div className="wdr-field">
          <label className="wdr-label" htmlFor="email">
            E-Mail-Adresse
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="deine@email.de"
            defaultValue={values.email}
            className="wdr-input"
          />
        </div>

        <div className="wdr-field">
          <label className="wdr-label" htmlFor="firstName">
            Vorname
          </label>
          <input
            id="firstName"
            name="firstName"
            required
            autoComplete="given-name"
            placeholder="Max"
            defaultValue={values.firstName}
            className="wdr-input"
          />
        </div>

        <div className="wdr-field">
          <label className="wdr-label" htmlFor="lastName">
            Nachname
          </label>
          <input
            id="lastName"
            name="lastName"
            required
            autoComplete="family-name"
            placeholder="Mustermann"
            defaultValue={values.lastName}
            className="wdr-input"
          />
        </div>

        <div className="wdr-field">
          <label className="wdr-label" htmlFor="orderNumber">
            Bestellnummer
          </label>
          <input
            id="orderNumber"
            name="orderNumber"
            required
            placeholder="#1001"
            defaultValue={values.orderNumber}
            className="wdr-input"
          />
        </div>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <button type="submit" className="wdr-btn wdr-btn--full" disabled={busy}>
          {busy ? 'Bestellung wird gesucht…' : 'Weiter zur Produktauswahl'}
        </button>
      </Form>
    </div>
  );
}
