import type {WithdrawalLineItem, WithdrawalStatus} from './server/admin.server';

export interface WiderrufFormValues {
  email: string;
  firstName: string;
  lastName: string;
  orderNumber: string;
}

export type WiderrufActionData =
  | {step: 'lookup'; error?: string; values: WiderrufFormValues}
  | {
      step: 'select';
      values: WiderrufFormValues;
      orderName: string;
      lineItems: WithdrawalLineItem[];
      error?: string;
    }
  | {step: 'done'; orderName: string; statusPath: string};

export interface WiderrufStatusValues {
  orderNumber: string;
  zip: string;
}

export type WiderrufStatusData =
  | {state: 'form'; error?: string; values: WiderrufStatusValues}
  | {
      state: 'result';
      orderName: string;
      status: WithdrawalStatus;
      items: string | null;
      labelUrl: string | null;
      // Für das erneute Absenden beim Zurückziehen (vom Kunden eingegeben).
      orderNumber: string;
      zip: string;
    }
  | {state: 'cancelled'; orderName: string};
