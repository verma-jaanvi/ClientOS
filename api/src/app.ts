import './types';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './env';
import { errorHandler } from './lib/errors';
import { requireStaff } from './middleware/staffAuth';
import { requireMagicLink } from './middleware/clientAuth';
import authRouter from './routes/auth';
import workspaceRouter from './routes/workspace';
import clientsRouter from './routes/clients';
import projectsRouter from './routes/projects';
import deliverablesRouter from './routes/deliverables';
import requestsRouter from './routes/requests';
import portalRouter from './routes/clientPortal';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// Cross-origin access for our own front end address only.
app.use(cors({ origin: env.APP_URL, allowedHeaders: ['Authorization', 'Content-Type', 'x-magic-token'] }));
app.use(express.json({ limit: '100kb' }));

const limiter = (windowMs: number, max: number) =>
  rateLimit({ windowMs, limit: max, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many requests. Try again shortly.' } });

app.get('/api/health', (_req, res) => void res.json({ status: 'ok' }));

// Public: sign-up and invite acceptance are rate limited. Log-in itself is handled (and limited) by Supabase Auth.
app.use('/api/auth', limiter(15 * 60_000, 20), authRouter);

// Client side: magic link only. Staff logins are never read here.
app.use('/api/c', limiter(60_000, 120));
app.use('/api/c/approve', limiter(15 * 60_000, 20));
app.use('/api/c', requireMagicLink, portalRouter);

// Agency side: staff login only. Magic links are never read here.
const staffRouter = express.Router();
staffRouter.use(requireStaff, limiter(60_000, 600));
staffRouter.use(workspaceRouter, clientsRouter, projectsRouter, deliverablesRouter, requestsRouter);
app.use('/api', staffRouter);

app.use(errorHandler);
