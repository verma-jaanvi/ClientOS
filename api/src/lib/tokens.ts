import crypto from 'crypto';
import { env } from '../env';

/** Long random string handed to the client. Only its hash is ever stored. */
export const newToken = () => crypto.randomBytes(32).toString('base64url');

/** Keyed hash (HMAC) so a leaked table alone cannot be used to forge or verify tokens. */
export const hashToken = (token: string) =>
  crypto.createHmac('sha256', env.MAGIC_LINK_SECRET).update(token).digest('hex');
