// Public-page structured data. Organization carries the brand only: no
// founder, email, telephone or postal address (those are personal data of
// the operator and stay off the schema graph).

import { absoluteUrl, type AppConfig } from '../config.js';
import { PUBLIC_PLAN_EUR } from '../domain/public-plans.js';
import { href, t, type LocaleCode } from './i18n.js';

export const SITE_DESCRIPTION =
  'Relicita tells IT and cybersecurity SMEs which software and cyber public contracts will be re-tendered, who holds them today and when to move. Evidence from TED and PLACSP.';

export const OG_IMAGE_PATH = '/og.png';
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function jsonLdScript(graph: Record<string, unknown>[]): string {
  return `<script type="application/ld+json">\n${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2)}\n</script>`;
}

/** Brand entity shared by every indexable page. No personal data. */
export function organizationLd(config: AppConfig, locale: LocaleCode): Record<string, unknown> {
  return {
    '@type': 'Organization',
    name: 'Relicita',
    url: absoluteUrl(config.baseUrl, '/'),
    logo: absoluteUrl(config.baseUrl, OG_IMAGE_PATH),
    description: t(locale, 'jsonLd.description'),
  };
}

export function websiteLd(
  config: AppConfig,
  locale: LocaleCode,
  path: string,
  description: string,
): Record<string, unknown> {
  return {
    '@type': ['WebSite', 'SoftwareApplication'],
    name: 'Relicita',
    url: absoluteUrl(config.baseUrl, path),
    inLanguage: locale,
    description,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
  };
}

export function faqLd(items: Array<{ question: string; answer: string }>): Record<string, unknown> {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: stripHtml(item.question),
      acceptedAnswer: {
        '@type': 'Answer',
        text: stripHtml(item.answer),
      },
    })),
  };
}

/** Product + Offers for the four public plans. Prices are the EUR catalog, not the legacy cents field. */
export function pricingProductLd(config: AppConfig, locale: LocaleCode): Record<string, unknown> {
  const url = absoluteUrl(config.baseUrl, href(locale, '/pricing'));
  const offers: Array<{ name: string; price: number; description: string }> = [
    { name: t(locale, 'plans.free.name'), price: PUBLIC_PLAN_EUR.free, description: t(locale, 'plans.free.desc') },
    { name: t(locale, 'plans.radar.name'), price: PUBLIC_PLAN_EUR.radarMonthly, description: t(locale, 'plans.radar.desc') },
    { name: t(locale, 'plans.pro.name'), price: PUBLIC_PLAN_EUR.proMonthly, description: t(locale, 'plans.pro.desc') },
    { name: t(locale, 'plans.team.name'), price: PUBLIC_PLAN_EUR.teamMonthly, description: t(locale, 'plans.team.desc') },
  ];
  return {
    '@type': 'Product',
    name: 'Relicita',
    description: t(locale, 'pricing.metaDescription'),
    brand: { '@type': 'Brand', name: 'Relicita' },
    offers: offers.map((offer) => {
      const price = String(offer.price);
      const listed = {
        '@type': 'Offer',
        name: offer.name,
        price,
        priceCurrency: 'EUR',
        url,
        availability: 'https://schema.org/InStock',
        description: stripHtml(offer.description),
      };
      if (offer.price === 0) return listed;
      return {
        ...listed,
        priceSpecification: {
          '@type': 'UnitPriceSpecification',
          price,
          priceCurrency: 'EUR',
          valueAddedTaxIncluded: false,
        },
      };
    }),
  };
}
