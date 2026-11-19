import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { supabase } from '../lib/supabase';
import { HttpError } from '../lib/errors';

/** Staff login check. Reads ONLY the Authorization header; magic-link tokens never work here. */
export async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Not signed in');
  const { data, error } = await supabase.auth.getUser(header.slice(7));
  if (error || !data.user) throw new HttpError(401, 'Session is not valid');
  const user = await prisma.user.findUnique({
    where: { authId: data.user.id },
    include: { workspace: true },
  });
  if (!user) throw new HttpError(401, 'This login has no workspace');
  req.staff = { user, workspace: user.workspace };
  next();
}
