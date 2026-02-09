import { Hono } from 'hono';
import { env } from '../env';

const ai = new Hono();

ai.post('/classify', async (c) => {
  const contentType = c.req.header('content-type') ?? '';
  const yoloUrl = `${env.YOLO_SERVICE_URL}/detect`;

  let response: Response | null = null;

  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    const file = body?.file;

    if (!(file instanceof File)) {
      return c.json({ error: 'No file uploaded.' }, 400);
    }

    const form = new FormData();
    form.append('file', file, file.name || 'upload.jpg');

    response = await fetch(yoloUrl, {
      method: 'POST',
      body: form,
    });
  } else {
    const payload = await c.req.json().catch(() => null);
    if (!payload?.imageUrl) {
      return c.json({ error: 'imageUrl is required.' }, 400);
    }

    response = await fetch(yoloUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: payload.imageUrl }),
    });
  }

  if (!response.ok) {
    const message = await response.text();
    return c.json({ error: `YOLO service error: ${message}` }, 502);
  }

  const result = await response.json();
  return c.json(result);
});

export default ai;
