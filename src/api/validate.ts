// zod validation schemas for all API inputs (SPEC §5 + §9).
// Query strings arrive as strings; coercion + max lengths + strict formats here.

import { z } from 'zod';

// --- primitive field schemas -------------------------------------------------

/** CPV code or prefix: 2–8 digits, optional "-digit" check suffix (SPEC §5). */
export const cpvSchema = z
  .string()
  .regex(/^\d{2,8}(-\d)?$/, 'cpv must be 2-8 digits, optionally followed by -<digit> (e.g. "72" or "72000000-2")');

/** ISO calendar date YYYY-MM-DD. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'date must be a valid calendar date');

/** NUTS region code or prefix, e.g. "ES", "ES6", "ES61", "ES611". Case-insensitive input. */
export const nutsSchema = z
  .string()
  .regex(/^[A-Za-z]{2}[A-Za-z0-9]{0,3}$/, 'region must be a NUTS code or prefix (e.g. "ES", "ES61")')
  .transform((s) => s.toUpperCase());

const textFragment = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} must be at least 2 characters`)
    .max(200, `${label} must be at most 200 characters`);

const pageSchema = z.coerce.number().int().min(1).default(1);
const sizeSchema = z.coerce.number().int().min(1).max(100, 'size must be ≤ 100').default(20);

export const paginationSchema = z.object({
  page: pageSchema,
  size: sizeSchema,
});

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive('id must be a positive integer'),
});

// --- endpoint query schemas --------------------------------------------------

export const searchQuerySchema = paginationSchema.extend({
  q: z.string().trim().min(1).max(200, 'q must be at most 200 characters').optional(),
  cpv: cpvSchema.optional(),
  buyer: textFragment('buyer').optional(),
  company: textFragment('company').optional(),
  region: nutsSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  type: z.enum(['award', 'tender', 'contract']).default('award'),
});

export const awardsQuerySchema = paginationSchema;

export const opportunitiesQuerySchema = paginationSchema;

export const renewalsQuerySchema = paginationSchema.extend({
  cpv: cpvSchema.optional(),
  buyer: textFragment('buyer').optional(),
  window_months: z.coerce.number().int().min(1).max(36, 'window_months must be ≤ 36').default(12),
  min_confidence: z.enum(['low', 'medium', 'high']).default('low'),
});

// --- inferred types ----------------------------------------------------------

export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type RenewalsQuery = z.infer<typeof renewalsQuerySchema>;
export type IdParam = z.infer<typeof idParamSchema>;

/** Deterministic confidence ordering used by /v1/renewals. */
export const CONFIDENCE_RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };
