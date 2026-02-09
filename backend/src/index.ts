import { Hono } from 'hono';
import { cors } from 'hono/cors';
import ai from './routes/ai';
import analytics from './routes/analytics';
import reports from './routes/reports';

const app = new Hono();

// Enable CORS for all routes
app.use(
  '*',
  cors({
    credentials: true,
    origin: (origin) => origin || '*',
  })
);

app.get('/', (c) => {
  return c.text('Hello Hono!');
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

app.route('/reports', reports);
app.route('/ai', ai);
app.route('/analytics', analytics);

const port = Number(process.env.PORT ?? 3002);

export default {
  fetch: app.fetch,
  port,
  hostname: '0.0.0.0',
};
