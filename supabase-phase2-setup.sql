-- ============================================================
-- INVICTUS IMC — Phase 2: Projects Table
-- Run in Supabase > SQL Editor > New Query
-- ============================================================

-- 1. PROJECTS TABLE
create table if not exists public.projects (
  id uuid default gen_random_uuid() primary key,
  buyer_id uuid references public.buyers(id) on delete set null,
  manufacturer_id uuid references public.manufacturers(id) on delete set null,
  product_name text not null,
  product_details jsonb, -- full product object from buyers.products[]
  status text not null default 'received' check (status in ('received','in_progress','quality_check','delivered','cancelled')),
  admin_notes text,
  timeline text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. ENABLE RLS
alter table public.projects enable row level security;

-- 3. RLS POLICIES

-- Buyers can only read their own projects
create policy "Buyers read own projects"
  on public.projects for select
  using (
    buyer_id in (
      select id from public.buyers where auth_user_id = auth.uid()
    )
  );

-- Manufacturers can only read projects assigned to them
create policy "Manufacturers read assigned projects"
  on public.projects for select
  using (
    manufacturer_id in (
      select id from public.manufacturers where auth_user_id = auth.uid()
    )
  );

-- 4. AUTO-UPDATE updated_at on change
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_projects_updated on public.projects;
create trigger on_projects_updated
  before update on public.projects
  for each row execute procedure public.handle_updated_at();

-- Done. Check: Table Editor > projects
