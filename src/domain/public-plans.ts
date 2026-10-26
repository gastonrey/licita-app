// Customer-facing EUR prices for the public plans (Free / Radar / Pro / Team).
// The human pricing page, Offer schema and the default CREEM_PRICE_CENTS all
// read Radar's monthly amount from here so a crawler never sees a second price.

export const PUBLIC_PLAN_EUR = {
  free: 0,
  radarMonthly: 39,
  radarAnnual: 390,
  proMonthly: 99,
  proAnnual: 990,
  teamMonthly: 199,
} as const;

/** Display amount for a public plan. Spanish uses "39 €"; English uses "€39". */
export function formatPublicEur(amount: number, locale: 'es' | 'en'): string {
  return locale === 'es' ? `${amount} €` : `€${amount}`;
}
