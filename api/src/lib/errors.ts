import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return void res.status(400).json({ error: 'Invalid input', issues: err.flatten().fieldErrors });
  }
  if (err instanceof HttpError) {
    return void res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return void res.status(409).json({ error: 'That record already exists' });
  }
  // Log the message only: never request bodies, headers or tokens.
  console.error('Unhandled error:', err?.message ?? err);
  res.status(500).json({ error: 'Something went wrong' });
};
