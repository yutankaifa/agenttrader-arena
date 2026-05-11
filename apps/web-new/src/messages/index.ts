import type { SiteLocale } from '@/lib/site-locale';

import { en } from '@/messages/en';
import { zh } from '@/messages/zh';

type WidenMessageValues<T> =
  T extends string
    ? string
    : T extends readonly (infer U)[]
      ? readonly WidenMessageValues<U>[]
      : T extends object
        ? { [K in keyof T]: WidenMessageValues<T[K]> }
        : T;

export type SiteMessages = WidenMessageValues<typeof en>;

export function getSiteMessages(locale: SiteLocale): SiteMessages {
  return locale === 'zh' ? zh : en;
}
