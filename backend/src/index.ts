import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './env';
import ai from './routes/ai';
import analytics from './routes/analytics';
import reports from './routes/reports';

const app = new Hono();

const allowedOrigins = env.ALLOWED_ORIGINS
  ? env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

app.use(
  '*',
  cors({
    credentials: true,
    origin: (origin) => {
      if (!origin) return null;
      if (allowedOrigins.length === 0) return origin; // permissive in dev
      return allowedOrigins.includes(origin) ? origin : null;
    },
  })
);

app.get('/', (c) => c.text('CivicWatch API'));

app.get('/health', (c) => c.json({ status: 'ok' }));

app.route('/reports', reports);
app.route('/ai', ai);
app.route('/analytics', analytics);

const port = Number(process.env.PORT ?? 3002);

export default {
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0',
};
