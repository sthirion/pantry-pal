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

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const updateProfileBodySchema = z.object({
  name: boundedName(100),
});

const passwordLengthMessage = `Must be ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;

export const changePasswordBodySchema = z
  .object({
    currentPassword: z.string().min(1, 'Required.').max(PASSWORD_MAX_LENGTH),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, passwordLengthMessage)
      .max(PASSWORD_MAX_LENGTH, passwordLengthMessage),
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ['newPassword'],
    message: 'Must differ from the current password.',
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
