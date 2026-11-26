import { z } from 'zod';
import { displayName } from './names.js';

export const uuidSchema = z.uuid();

export const changedAtSchema = z.iso.datetime({ offset: true });

const boundedName = (max: number) =>
  z
    .string()
    .transform(displayName)
    .pipe(
      z
        .string()
        .min(1, `Must be 1 to ${max} characters.`)
        .max(max, `Must be 1 to ${max} characters.`),
    );

export const putListBodySchema = z.object({
  name: boundedName(100),
  changedAt: changedAtSchema,
});

export const putItemBodySchema = z.object({
  name: boundedName(200),
  crossedOff: z.boolean(),
  changedAt: changedAtSchema,
});

/** Changed-field patch of an item mutation: only allowlisted fields, at least one. */
export const itemChangesSchema = z
  .strictObject({
    name: boundedName(200).optional(),
    crossedOff: z.boolean().optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, {
    message: 'Must change at least one field.',
  });

export const itemMutationBodySchema = z.strictObject({
  mutationId: uuidSchema,
  baseItemRevision: z.int().positive(),
  changes: itemChangesSchema,
});

export const deleteItemsBodySchema = z.object({
  itemIds: z.array(uuidSchema).min(1).max(500),
  changedAt: changedAtSchema,
});

/** `since` query parameter: non-negative integer string, defaults to 0. */
export const sinceQuerySchema = z
  .string()
  .regex(/^\d+$/, 'Must be a non-negative integer.')
  .transform(Number)
  .pipe(
    z.number().refine(Number.isSafeInteger, 'Must be a non-negative integer.'),
  )
  .default(0);
