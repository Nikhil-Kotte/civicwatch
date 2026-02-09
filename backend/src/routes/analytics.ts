import { Hono } from 'hono';
import { env } from '../env';
import { supabase } from '../supabase';

const analytics = new Hono();

const SEVERITY_WEIGHT: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

function daysOpen(createdAt?: string | null) {
  if (!createdAt) {
    return 0;
  }
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000)));
}

function urgencyScore(report: Record<string, any>) {
  const severity = SEVERITY_WEIGHT[report.severity] ?? 1;
  const openDays = daysOpen(report.created_at);
  const base = severity * 10 + Math.min(openDays, 14) * 2 + (report.upvotes ?? 0);
  if (report.status === 'resolved') {
    return Math.round(base * 0.2);
  }
  return Math.round(base);
}

analytics.get('/summary', async (c) => {
  const response = await fetch(`${env.PATHWAY_SERVICE_URL}/summary`);
  if (!response.ok) {
    return c.json({ error: 'Pathway summary unavailable.' }, 502);
  }
  const data = await response.json();
  return c.json(data);
});

analytics.get('/heatmap', async (c) => {
  const params = c.req.query();
  const query = new URLSearchParams(params as Record<string, string>);
  const response = await fetch(`${env.PATHWAY_SERVICE_URL}/heatmap?${query.toString()}`);
  if (!response.ok) {
    return c.json({ error: 'Pathway heatmap unavailable.' }, 502);
  }
  const data = await response.json();
  return c.json(data);
});

analytics.get('/alerts', async (c) => {
  const response = await fetch(`${env.PATHWAY_SERVICE_URL}/alerts`);
  if (!response.ok) {
    return c.json({ error: 'Pathway alerts unavailable.' }, 502);
  }
  const data = await response.json();
  return c.json(data);
});

analytics.get('/urgency-heatmap', async (c) => {
  const params = c.req.query();
  const cellSize = Number(params.cell_size ?? '0.01');
  const days = Number(params.days ?? '30');
  if (!cellSize || cellSize <= 0) {
    return c.json({ error: 'cell_size must be positive.' }, 400);
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('reports')
    .select('latitude, longitude, severity, status, created_at, upvotes')
    .gte('created_at', cutoff);

  if (error) {
    return c.json({ error: error.message }, 500);
  }

  const buckets = new Map<string, { lat: number; lng: number; count: number; urgency: number }>();
  for (const report of data ?? []) {
    const lat = Math.round(report.latitude / cellSize) * cellSize;
    const lng = Math.round(report.longitude / cellSize) * cellSize;
    const key = `${lat}:${lng}`;
    const score = urgencyScore(report);
    const entry = buckets.get(key) ?? { lat, lng, count: 0, urgency: 0 };
    entry.count += 1;
    entry.urgency += score;
    buckets.set(key, entry);
  }

  return c.json({
    cellSize,
    days,
    cells: Array.from(buckets.values()).map((cell) => ({
      lat: cell.lat,
      lng: cell.lng,
      count: cell.count,
      urgency: cell.urgency,
    })),
  });
});

export default analytics;
