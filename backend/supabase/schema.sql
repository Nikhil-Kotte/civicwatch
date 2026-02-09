-- Enable extensions
create extension if not exists "pgcrypto";

-- Reports table
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  category text not null,
  status text not null default 'submitted',
  severity text not null,
  ticket_id text not null,
  image_url text,
  image_path text,
  resolved_image_url text,
  resolved_image_path text,
  resolved_confidence double precision not null default 0,
  resolved_verified boolean not null default false,
  resolved_at timestamptz,
  latitude double precision not null,
  longitude double precision not null,
  address text not null,
  user_id uuid,
  user_name text,
  upvotes integer not null default 0,
  duplicate_of uuid references public.reports (id) on delete set null,
  duplicate_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reports_created_at_idx on public.reports (created_at desc);
create index if not exists reports_category_idx on public.reports (category);
create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_duplicate_of_idx on public.reports (duplicate_of);
create unique index if not exists reports_ticket_id_idx on public.reports (ticket_id);

-- Detection results
create table if not exists public.report_detections (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports (id) on delete cascade,
  label text not null,
  confidence double precision not null,
  bbox jsonb not null,
  model_version text,
  created_at timestamptz not null default now()
);

-- Update updated_at on changes
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at
before update on public.reports
for each row
execute function public.set_updated_at();
