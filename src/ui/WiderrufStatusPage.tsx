import {Form, useActionData, useNavigation} from 'react-router';
import {WiderrufStyles} from './styles';
import type {WiderrufStatusData, WiderrufStatusValues} from '../types';
import type {WithdrawalStatus} from '../server/admin.server';

const EMPTY: WiderrufStatusValues = {orderNumber: '', zip: ''};

const STEPS: Array<{key: WithdrawalStatus; title: string; desc: string}> = [
  {key: 'received', title: 'Widerruf eingegangen', desc: 'Wir haben deinen Widerruf erhalten und prüfen ihn.'},
  {key: 'label_ready', title: 'Rücksendeschein bereit', desc: 'Bitte sende die Ware innerhalb von 14 Tagen zurück.'},
  {key: 'refunded', title: 'Erstattet', desc: 'Die Erstattung wurde veranlasst.'},
];

const ORDER: WithdrawalStatus[] = ['received', 'label_ready', 'refunded'];

function ErrorNote({children}: {children: React.ReactNode}) {
  return <p className="wdr-error">{children}</p>;
}

export function WiderrufStatusPage() {
  const data = useActionData() as WiderrufStatusData | undefined;
  const nav = useNavigation();
  const busy = nav.state !== 'idle';

  // ── Zurückgezogen ───────────────────────────────────────────────────────────
  if (data?.state === 'cancelled') {
    return (
      <div className="wdr">
      <WiderrufStyles />
        <div className="wdr-success-icon" aria-hidden>
          ✓
        </div>
        <h1 className="wdr-h1">Widerruf zurückgezogen</h1>
        <p className="wdr-lead">
          Dein Widerruf zur Bestellung <strong>{data.orderName}</strong> wurde
          zurückgezogen. Deine Bestellung bleibt bestehen. Eine Bestätigung ist
          unterwegs.
        </p>
        <a href="/widerruf/status" className="wdr-link">
          Zurück zum Status
        </a>
      </div>
    );
  }

  // ── Ergebnis ────────────────────────────────────────────────────────────────
  if (data?.state === 'result') {
    const currentIdx = ORDER.indexOf(data.status);
    return (
      <div className="wdr">
      <WiderrufStyles />
        <h1 className="wdr-h1">Status deines Widerrufs</h1>
        <p className="wdr-lead">
          Bestellung <strong>{data.orderName}</strong>
        </p>

        <ol className="wdr-steps">
          {STEPS.map((step, idx) => {
            const state =
              idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : 'pending';
            return (
              <li key={step.key} className={`wdr-step wdr-step--${state}`}>
                <span className="wdr-step__dot" aria-hidden />
                <div className="wdr-step__title">{step.title}</div>
                <div className="wdr-step__desc">{step.desc}</div>
                {step.key === 'label_ready' &&
                idx <= currentIdx &&
                data.labelUrl ? (
                  <a
                    className="wdr-btn"
                    style={{marginTop: 12}}
                    href={data.labelUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Rücksendeschein herunterladen
                  </a>
                ) : null}
              </li>
            );
          })}
        </ol>

        {data.items ? (
          <div className="wdr-card wdr-mt">
            <div className="wdr-step__title" style={{marginBottom: 8}}>
              Betroffene Artikel
            </div>
            <div className="wdr-step__desc" style={{whiteSpace: 'pre-line'}}>
              {data.items}
            </div>
          </div>
        ) : null}

        {data.status === 'received' ? (
          <Form method="post" className="wdr-mt">
            <input type="hidden" name="intent" value="cancel" />
            <input type="hidden" name="orderNumber" value={data.orderNumber} />
            <input type="hidden" name="zip" value={data.zip} />
            <button
              type="submit"
              className="wdr-btn wdr-btn--ghost wdr-btn--full"
              disabled={busy}
            >
              {busy ? 'Wird zurückgezogen…' : 'Widerruf zurückziehen'}
            </button>
          </Form>
        ) : null}

        <a href="/widerruf/status" className="wdr-link wdr-mt">
          Andere Bestellung prüfen
        </a>
      </div>
    );
  }

  // ── Login (Bestellnummer + PLZ) ─────────────────────────────────────────────
  const values = data?.state === 'form' ? data.values : EMPTY;
  const error = data?.state === 'form' ? data.error : undefined;

  return (
    <div className="wdr">
      <WiderrufStyles />
      <h1 className="wdr-h1">Widerruf-Status</h1>
      <p className="wdr-lead">
        Gib deine Bestellnummer und die Postleitzahl deiner Lieferadresse ein, um den
        Status deines Widerrufs zu sehen.
      </p>

      <Form method="post" className="wdr-form">
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

        <div className="wdr-field">
          <label className="wdr-label" htmlFor="zip">
            Postleitzahl (Lieferadresse)
          </label>
          <input
            id="zip"
            name="zip"
            required
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="10115"
            defaultValue={values.zip}
            className="wdr-input"
          />
        </div>

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <button type="submit" className="wdr-btn wdr-btn--full" disabled={busy}>
          {busy ? 'Wird geprüft…' : 'Status anzeigen'}
        </button>
      </Form>
    </div>
  );
}
