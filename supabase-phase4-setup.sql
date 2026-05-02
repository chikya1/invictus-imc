-- ============================================================
-- INVICTUS IMC — Phase 4: Project Acceptance Flow + Notes
-- Run in Supabase > SQL Editor > New Query
-- ============================================================

-- 1. ADD COLUMNS TO PROJECTS TABLE
alter table public.projects
  add column if not exists acceptance_status text default 'received'
    check (acceptance_status in ('received','accepted','denied')),
  add column if not exists needs_info boolean default false,
  add column if not exists denial_note text;

-- 2. PROJECT NOTES TABLE (threaded admin <-> buyer communication)
create table if not exists public.project_notes (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade,
  note_type text not null check (note_type in ('admin_query','buyer_reply','denial_note')),
  content text not null,
  created_by text not null check (created_by in ('admin','buyer')),
  is_read boolean default false,
  created_at timestamptz default now()
);

alter table public.project_notes enable row level security;

-- Buyers can read notes on their own projects
create policy "Buyers read own notes"
  on public.project_notes for select
  using (
    project_id in (
      select id from public.projects where buyer_id in (
        select id from public.buyers where auth_user_id = auth.uid()
      )
    )
  );

-- Buyers can insert replies on their own projects
create policy "Buyers insert replies"
  on public.project_notes for insert
  with check (
    created_by = 'buyer'
    and project_id in (
      select id from public.projects where buyer_id in (
        select id from public.buyers where auth_user_id = auth.uid()
      )
    )
  );

-- Admin full access
create policy "Public read notes"
  on public.project_notes for select using (true);

create policy "Public write notes"
  on public.project_notes for all using (true) with check (true);

-- Done.
