import type {CSSProperties, ReactNode} from 'react';

export interface WiderrufButtonProps {
  /** Ziel-Pfad der Widerruf-Seite. Standard: /widerruf */
  to?: string;
  /** Button-Text. Standard: „Vertrag widerrufen" */
  children?: ReactNode;
  /** Eigene CSS-Klasse — überschreibt das Standard-Styling komplett. */
  className?: string;
  /** Zusätzliche Inline-Styles (werden mit den Defaults gemerged). */
  style?: CSSProperties;
}

const DEFAULT_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '13px 22px',
  fontSize: 13,
  fontWeight: 600,
  textDecoration: 'none',
  color: '#fff',
  background: '#0a0a0a',
  border: '1px solid #0a0a0a',
  borderRadius: 10,
};

/**
 * Schlichter Link zur Widerruf-Seite für den Footer. Wenn `className` gesetzt ist,
 * werden die Default-Inline-Styles weggelassen, damit der Host frei stylen kann.
 */
export function WiderrufButton({
  to = '/widerruf',
  children = 'Vertrag widerrufen',
  className,
  style,
}: WiderrufButtonProps) {
  return (
    <a
      href={to}
      className={className}
      style={className ? style : {...DEFAULT_STYLE, ...style}}
    >
      {children}
    </a>
  );
}
