import type { User, Workspace, MagicLink, Contact, Client } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      staff?: { user: User; workspace: Workspace };
      magic?: { link: MagicLink; contact: Contact; client: Client; workspace: Workspace };
    }
  }
}
export {};
