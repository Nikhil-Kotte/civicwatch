import { Hono } from 'hono';
import { env } from '../env';
import { supabase } from '../supabase';
import { urgencyScore } from '../utils';

const analytics = new Hono();

analytics.get('/summary', async (c) => {
  const response = await fetch(`${env.PATHWAY_SERVICE_URL}/summary`);
  if (!response.ok) return c.json({ error: 'Pathway summary unavailable.' }, 502);
  return c.json(await response.json());
});

analytics.get('/heatmap', async (c) => {
  const params = c.req.query();
  const query = new URLSearchParams(params as Record<string, string>);
  const response = await fetch(`${env.PATHWAY_SERVICE_URL}/heatmap?${query.toString()}`);
  if (!response.ok) return c.json({ error: 'Pathway heatmap unavailable.' }, 502);
  return c.json(await response.json());
});

analytics.get('/alerts', async (c) => {
  const response = await fetch(`${env.PATHWAY_SERVICE_URL}/alerts`);
  if (!response.ok) return c.json({ error: 'Pathway alerts unavailable.' }, 502);
  return c.json(await response.json());
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

  if (error) return c.json({ error: error.message }, 500);

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

// Local summary built directly from Supabase (no Pathway dependency)
analytics.get('/local-summary', async (c) => {
  const { data, error } = await supabase
    .from('reports')
    .select('status, severity, category, upvotes, created_at');

  if (error) return c.json({ error: error.message }, 500);

  const rows = data ?? [];
  const byStatus: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  let totalUpvotes = 0;

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    totalUpvotes += r.upvotes ?? 0;
  }

  return c.json({
    total: rows.length,
    byStatus,
    byCategory,
    bySeverity,
    totalUpvotes,
  });
});

export default analytics;
