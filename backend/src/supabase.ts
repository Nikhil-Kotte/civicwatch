import { createClient } from '@supabase/supabase-js';
import { env, requireEnv } from './env';

export const supabase = createClient(
  requireEnv('SUPABASE_URL'),
  requireEnv('SUPABASE_SERVICE_ROLE_KEY')
);

export const storageBucket = env.SUPABASE_STORAGE_BUCKET;
