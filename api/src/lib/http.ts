import type { Request, Response, NextFunction } from 'express';
import { z, ZodTypeAny } from 'zod';
import { HttpError } from './errors';

export const parse = <T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> =>
  schema.parse(data ?? {});

export function staff(req: Request) {
  if (!req.staff) throw new HttpError(401, 'Not signed in');
  return req.staff;
}

export function magic(req: Request) {
  if (!req.magic) throw new HttpError(401, 'Link not valid', 'LINK_INVALID');
  return req.magic;
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (staff(req).user.role !== 'ADMIN') throw new HttpError(403, 'Admins only');
  next();
}

export function must<T>(value: T | null | undefined, message = 'Not found'): T {
  if (value === null || value === undefined) throw new HttpError(404, message);
  return value;
}
