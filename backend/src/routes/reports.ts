import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { env } from '../env';
import { supabase, storageBucket } from '../supabase';
import {
  DUPLICATE_BBOX_DELTA,
  DUPLICATE_RADIUS_KM,
  RESOLUTION_CONFIDENCE_THRESHOLD,
  daysOpen,
  escalationLevel,
  haversineKm,
  urgencyScore,
} from '../utils';

const reports = new Hono();

type DbReport = Record<string, any>;

async function fetchYolo(request: RequestInit) {
  try {
    return await fetch(`${env.YOLO_SERVICE_URL}/detect`, request);
  } catch {
    return null;
  }
}

function makeTicketId() {
  const suffix = crypto.randomUUID().split('-')[0]?.toUpperCase() ?? String(Date.now());
  return `CIM-${suffix}`;
}

const REPORT_CATEGORIES = [
  'pothole',
  'garbage',
  'broken_streetlight',
  'damaged_road',
  'water_leak',
  'other',
] as const;

const REPORT_STATUSES = ['submitted', 'in_progress', 'resolved'] as const;
const SEVERITY_LEVELS = ['low', 'medium', 'high', 'urgent'] as const;

const createReportSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional().default(''),
  category: z.enum(REPORT_CATEGORIES),
  severity: z.enum(SEVERITY_LEVELS),
  status: z.enum(REPORT_STATUSES).optional().default('submitted'),
  ticketId: z.string().optional(),
  imageUrl: z.string().url().nullable().optional(),
  imagePath: z.string().nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().min(1).max(500),
  userId: z.string().uuid().nullable().optional(),
  userName: z.string().max(100).nullable().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(REPORT_STATUSES),
});

function mapReport(row: DbReport) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    category: row.category,
    status: row.status,
    severity: row.severity,
    ticketId: row.ticket_id ?? makeTicketId(),
    imageUrl: row.image_url ?? null,
    imagePath: row.image_path ?? null,
    resolvedImageUrl: row.resolved_image_url ?? null,
    resolvedImagePath: row.resolved_image_path ?? null,
    resolvedConfidence: row.resolved_confidence ?? 0,
    resolvedVerified: row.resolved_verified ?? false,
    resolvedAt: row.resolved_at ?? null,
    latitude: row.latitude,
    longitude: row.longitude,
    address: row.address,
    userId: row.user_id ?? null,
    userName: row.user_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    upvotes: row.upvotes ?? 0,
    duplicateOf: row.duplicate_of ?? null,
    duplicateCount: row.duplicate_count ?? 0,
    daysOpen: daysOpen(row.created_at),
    escalationLevel: escalationLevel(row.status, row.created_at),
    urgencyScore: urgencyScore(row),
  };
}

async function findDuplicateMaster(
  category: string,
  latitude: number,
  longitude: number
): Promise<{ id: string; distanceKm: number } | null> {
  const { data, error } = await supabase
    .from('reports')
    .select('id, latitude, longitude')
    .eq('category', category)
    .neq('status', 'resolved')
    .gte('latitude', latitude - DUPLICATE_BBOX_DELTA)
    .lte('latitude', latitude + DUPLICATE_BBOX_DELTA)
    .gte('longitude', longitude - DUPLICATE_BBOX_DELTA)
    .lte('longitude', longitude + DUPLICATE_BBOX_DELTA)
    .order('created_at', { ascending: false })
    .limit(8);

  if (error || !data || data.length === 0) return null;

  let best: { id: string; distanceKm: number } | null = null;
  for (const row of data) {
    const distanceKm = haversineKm(latitude, longitude, row.latitude, row.longitude);
    if (distanceKm <= DUPLICATE_RADIUS_KM && (!best || distanceKm < best.distanceKm)) {
      best = { id: row.id, distanceKm };
    }
  }
  return best;
}

// GET /reports?status=&category=&userId=
reports.get('/', async (c) => {
  const { status, category, userId } = c.req.query();

  let query = supabase.from('reports').select('*').order('created_at', { ascending: false });

  if (status && REPORT_STATUSES.includes(status as any)) {
    query = query.eq('status', status);
  }
  if (category && REPORT_CATEGORIES.includes(category as any)) {
    query = query.eq('category', category);
  }
  if (userId) {
    query = query.eq('user_id', userId);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);

  return c.json((data ?? []).map(mapReport));
});

reports.get('/:id', async (c) => {
  const id = c.req.param('id');
  const { data, error } = await supabase.from('reports').select('*').eq('id', id).single();
  if (error) return c.json({ error: error.message }, 404);
  return c.json(mapReport(data));
});

reports.post('/', zValidator('json', createReportSchema), async (c) => {
  const body = c.req.valid('json');

  const duplicateMaster = await findDuplicateMaster(body.category, body.latitude, body.longitude);

  const insertPayload = {
    title: body.title.trim(),
    description: body.description?.trim() ?? '',
    category: body.category,
    status: body.status ?? 'submitted',
    severity: body.severity,
    ticket_id: body.ticketId ?? makeTicketId(),
    image_url: body.imageUrl ?? null,
    image_path: body.imagePath ?? null,
    latitude: body.latitude,
    longitude: body.longitude,
    address: body.address.trim(),
    user_id: body.userId ?? null,
    user_name: body.userName?.trim() ?? null,
    duplicate_of: duplicateMaster?.id ?? null,
  };

  const { data, error } = await supabase.from('reports').insert(insertPayload).select('*').single();
  if (error) return c.json({ error: error.message }, 500);

  if (duplicateMaster) {
    const { error: rpcError } = await supabase.rpc('increment_duplicate_count', { report_id: duplicateMaster.id });
    if (rpcError) {
      // Fallback: read-then-write if RPC not available
      supabase
        .from('reports')
        .select('duplicate_count')
        .eq('id', duplicateMaster.id)
        .single()
        .then(({ data: master }) => {
          supabase
            .from('reports')
            .update({ duplicate_count: (master?.duplicate_count ?? 0) + 1 })
            .eq('id', duplicateMaster.id);
        });
    }
  }

  void notifyPathway(data);
  return c.json(mapReport(data), 201);
});

reports.patch('/:id/status', zValidator('json', updateStatusSchema), async (c) => {
  const id = c.req.param('id');
  const { status } = c.req.valid('json');

  const { data, error } = await supabase
    .from('reports')
    .update({ status })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return c.json({ error: error.message }, 404);
  return c.json(mapReport(data));
});

reports.post('/:id/upvote', async (c) => {
  const id = c.req.param('id');
  const { data: current, error: fetchError } = await supabase
    .from('reports')
    .select('upvotes')
    .eq('id', id)
    .single();

  if (fetchError || !current) {
    return c.json({ error: fetchError?.message ?? 'Report not found' }, 404);
  }

  const { data, error } = await supabase
    .from('reports')
    .update({ upvotes: (current.upvotes ?? 0) + 1 })
    .eq('id', id)
    .select('*')
    .single();

  if (error) return c.json({ error: error.message }, 500);
  return c.json(mapReport(data));
});

reports.post('/:id/escalation', async (c) => {
  const id = c.req.param('id');
  const { data, error } = await supabase.from('reports').select('*').eq('id', id).single();
  if (error || !data) return c.json({ error: error?.message ?? 'Report not found' }, 404);

  const tone = escalationLevel(data.status, data.created_at);
  const openDays = daysOpen(data.created_at);
  const formattedDate = new Date().toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const subject = `Complaint regarding ${String(data.category).replace(/_/g, ' ')}`;
  const intro =
    tone === 'urgent'
      ? 'This is an urgent follow-up.'
      : tone === 'firm'
        ? 'This is a firm follow-up on the unresolved issue.'
        : 'This is a polite follow-up.';

  const body = `Your Address\nCity - PIN\nState\n\nDate: ${formattedDate}\n\nTo\nThe Municipal Commissioner\n<Name of Municipal Corporation>\nCity - PIN\nState\n\nSubject: ${subject}\n\nSir/Madam,\n\nI am a resident of <your area/society>. I wish to bring to your notice that ${String(data.category).replace(/_/g, ' ')} has been occurring since <when>.\n\nThe issue is located at ${data.address}. ${data.description || 'Please refer to the report details.'}\nThis has caused <impact> to residents. We have previously complained via <phone/portal> (Complaint No: ${data.ticket_id}) if applicable.\n\n${intro} The issue has been open for ${openDays} day(s). Kindly resolve this at the earliest.\n\nThanking you,\n\nYours faithfully,\n<Your full name>\n<Your mobile number>\n<Email, if any>`;

  return c.json({ tone, openDays, subject, body });
});

reports.post('/:id/verify', async (c) => {
  const id = c.req.param('id');
  const reportRes = await supabase.from('reports').select('*').eq('id', id).single();
  if (reportRes.error || !reportRes.data) {
    return c.json({ error: reportRes.error?.message ?? 'Report not found' }, 404);
  }

  const report = reportRes.data;
  if (!report.image_url) {
    return c.json({ error: 'Report has no before image to verify against.' }, 400);
  }

  const contentType = c.req.header('content-type') ?? '';
  let afterImageUrl: string | null = null;
  let afterImagePath: string | null = null;
  let afterDetections: any[] = [];

  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    const file = body?.file;
    if (!(file instanceof File)) return c.json({ error: 'No file uploaded.' }, 400);

    const form = new FormData();
    form.append('file', file, file.name || 'after.jpg');
    const yoloResponse = await fetchYolo({
      method: 'POST',
      body: form,
    });
    if (!yoloResponse) {
      return c.json({ error: 'YOLO service unavailable.' }, 502);
    }
    if (!yoloResponse.ok) {
      return c.json({ error: `YOLO service error: ${await yoloResponse.text()}` }, 502);
    }
    afterDetections = (await yoloResponse.json()).detections ?? [];
  } else {
    const payload = await c.req.json().catch(() => null);
    afterImageUrl = payload?.afterImageUrl ?? null;
    afterImagePath = payload?.afterImagePath ?? null;
    if (!afterImageUrl) return c.json({ error: 'afterImageUrl is required.' }, 400);

    const yoloResponse = await fetchYolo({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: afterImageUrl }),
    });
    if (!yoloResponse) {
      return c.json({ error: 'YOLO service unavailable.' }, 502);
    }
    if (!yoloResponse.ok) {
      return c.json({ error: `YOLO service error: ${await yoloResponse.text()}` }, 502);
    }
    afterDetections = (await yoloResponse.json()).detections ?? [];
  }

  const beforeResponse = await fetchYolo({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: report.image_url }),
  });
  if (!beforeResponse) {
    return c.json({ error: 'YOLO service unavailable.' }, 502);
  }
  if (!beforeResponse.ok) {
    return c.json({ error: `YOLO service error: ${await beforeResponse.text()}` }, 502);
  }
  const beforeDetections = (await beforeResponse.json()).detections ?? [];

  const target = String(report.category);
  const scoreFor = (detections: any[]) =>
    detections
      .filter((det) => det.label === target)
      .reduce((sum, det) => sum + (Number(det.confidence) || 0), 0);

  const beforeScore = scoreFor(beforeDetections);
  const afterScore = scoreFor(afterDetections);
  const safeBefore = Math.max(beforeScore, 0.05);
  const drop = Math.max(0, safeBefore - afterScore);
  const resolutionConfidence = Math.min(1, drop / safeBefore);
  const resolvedVerified = resolutionConfidence >= RESOLUTION_CONFIDENCE_THRESHOLD;

  const { data: updated, error: updateError } = await supabase
    .from('reports')
    .update({
      resolved_image_url: afterImageUrl,
      resolved_image_path: afterImagePath,
      resolved_confidence: resolutionConfidence,
      resolved_verified: resolvedVerified,
      resolved_at: resolvedVerified ? new Date().toISOString() : null,
      status: resolvedVerified ? 'resolved' : report.status,
    })
    .eq('id', id)
    .select('*')
    .single();

  if (updateError || !updated) {
    return c.json({ error: updateError?.message ?? 'Failed to update report' }, 500);
  }

  return c.json({ report: mapReport(updated), beforeScore, afterScore, resolutionConfidence, resolvedVerified });
});

reports.post('/upload', async (c) => {
  const body = await c.req.parseBody();
  const file = body?.file;
  if (!(file instanceof File)) return c.json({ error: 'No file uploaded.' }, 400);

  const extension = file.name?.split('.').pop() || 'jpg';
  const fileName = `${crypto.randomUUID()}.${extension}`;
  const datePrefix = new Date().toISOString().split('T')[0];
  const filePath = `${datePrefix}/${fileName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error } = await supabase.storage.from(storageBucket).upload(filePath, buffer, {
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });
  if (error) return c.json({ error: error.message }, 500);

  const { data } = supabase.storage.from(storageBucket).getPublicUrl(filePath);
  return c.json({ path: filePath, publicUrl: data.publicUrl, bucket: storageBucket });
});

async function notifyPathway(report: Record<string, unknown>) {
  if (!env.PATHWAY_SERVICE_URL) return;
  try {
    await fetch(`${env.PATHWAY_SERVICE_URL}/ingest/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
    });
  } catch {
    // Pathway notification is best-effort; report creation already succeeded.
  }
}

export default reports;
