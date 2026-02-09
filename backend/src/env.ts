export const env = {
  SUPABASE_URL: process.env.SUPABASE_URL ?? '',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET ?? 'reports',
  YOLO_SERVICE_URL: process.env.YOLO_SERVICE_URL ?? 'http://localhost:8001',
  PATHWAY_SERVICE_URL: process.env.PATHWAY_SERVICE_URL ?? 'http://localhost:8002',
};

export function requireEnv(name: keyof typeof env): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}
