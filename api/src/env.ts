import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  MAGIC_LINK_SECRET: z.string().min(32, 'MAGIC_LINK_SECRET must be at least 32 characters'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('ClientOS <onboarding@resend.dev>'),
  DEV_LOG_EMAILS: z.string().optional(),
  APP_URL: z.string().url(),
  LINK_TTL_DAYS: z.coerce.number().int().min(1).default(14),
  FILES_BUCKET: z.string().default('deliverables'),
  LOGOS_BUCKET: z.string().default('logos'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const env = { ...parsed.data, APP_URL: parsed.data.APP_URL.replace(/\/$/, '') };
