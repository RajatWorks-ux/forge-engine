-- ============================================================
-- FORGE — Supabase Setup
-- Go to: supabase.com → your project → SQL Editor → New Query
-- Paste this entire file → click RUN
-- ============================================================

create table if not exists jobs (
  id            text primary key,
  prompt        text not null,
  style         text not null,
  duration      integer not null,
  status        text not null default 'queued',
  stage         text,
  stage_label   text,
  progress      integer not null default 0,
  video_url     text,
  error         text,
  job_json      jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists jobs_updated_at on jobs;
create trigger jobs_updated_at
  before update on jobs
  for each row execute function update_updated_at();

alter publication supabase_realtime add table jobs;

alter table jobs enable row level security;
create policy "Public read"    on jobs for select using (true);
create policy "Service insert" on jobs for insert with check (true);
create policy "Service update" on jobs for update using (true);

-- ============================================================
-- After running this SQL:
-- Go to Storage → New bucket → Name: forge-videos → Public: ON
-- ============================================================
