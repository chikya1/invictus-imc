-- ============================================================
-- INVICTUS IMC — Phase 3: Project Management
-- Run in Supabase > SQL Editor > New Query
-- ============================================================

-- 1. ADD STATUS PIPELINE TO PROJECTS
alter table public.projects
  add column if not exists status_updated_at timestamptz default now(),
  add column if not exists completion_note text,
  add column if not exists admin_approved boolean default false;

-- Update status check constraint to new pipeline
alter table public.projects
  drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (status in ('received','accepted','in_production','qc','shipped','delivered','closed','cancelled'));

-- 2. BUYER PAYMENT MILESTONES
create table if not exists public.buyer_milestones (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade,
  milestone_number int not null,
  description text not null,
  percentage numeric(5,2),
  amount numeric(12,2),
  currency text default 'INR',
  due_date text,
  status text default 'pending' check (status in ('pending','invoiced','paid')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.buyer_milestones enable row level security;

-- Buyers can read their own milestones
create policy "Buyers read own milestones"
  on public.buyer_milestones for select
  using (
    project_id in (
      select id from public.projects where buyer_id in (
        select id from public.buyers where auth_user_id = auth.uid()
      )
    )
  );

-- Admin full access (via public read since we use anon key in admin)
create policy "Public read buyer milestones"
  on public.buyer_milestones for select using (true);

create policy "Public write buyer milestones"
  on public.buyer_milestones for all using (true) with check (true);

-- 3. MANUFACTURER PAYMENT MILESTONES
create table if not exists public.manufacturer_milestones (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade,
  milestone_number int not null,
  description text not null,
  percentage numeric(5,2),
  amount numeric(12,2),
  currency text default 'INR',
  due_date text,
  status text default 'pending' check (status in ('pending','invoiced','paid')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.manufacturer_milestones enable row level security;

-- Manufacturers can read their own milestones
create policy "Manufacturers read own milestones"
  on public.manufacturer_milestones for select
  using (
    project_id in (
      select id from public.projects where manufacturer_id in (
        select id from public.manufacturers where auth_user_id = auth.uid()
      )
    )
  );

create policy "Public read manufacturer milestones"
  on public.manufacturer_milestones for select using (true);

create policy "Public write manufacturer milestones"
  on public.manufacturer_milestones for all using (true) with check (true);

-- 4. DOCUMENTS TABLE (text-based, no file uploads)
create table if not exists public.project_documents (
  id uuid default gen_random_uuid() primary key,
  project_id uuid references public.projects(id) on delete cascade,
  doc_type text not null check (doc_type in ('buyer_po','admin_to_mfg_po','buyer_qc','mfg_qc')),
  -- buyer_po: buyer raises PO to IMC
  -- admin_to_mfg_po: IMC raises PO to manufacturer
  -- buyer_qc: QC cert shown to buyer
  -- mfg_qc: QC cert from manufacturer
  content text not null,
  reference_number text,
  raised_by text, -- 'buyer', 'admin', 'manufacturer'
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.project_documents enable row level security;

-- Buyers can only see their own PO and their QC cert (not mfg docs)
create policy "Buyers read own docs"
  on public.project_documents for select
  using (
    doc_type in ('buyer_po', 'buyer_qc')
    and project_id in (
      select id from public.projects where buyer_id in (
        select id from public.buyers where auth_user_id = auth.uid()
      )
    )
  );

-- Manufacturers can only see their PO and their QC cert (not buyer docs)
create policy "Manufacturers read own docs"
  on public.project_documents for select
  using (
    doc_type in ('admin_to_mfg_po', 'mfg_qc')
    and project_id in (
      select id from public.projects where manufacturer_id in (
        select id from public.manufacturers where auth_user_id = auth.uid()
      )
    )
  );

-- Buyers can insert their own PO
create policy "Buyers insert own PO"
  on public.project_documents for insert
  with check (
    doc_type = 'buyer_po'
    and project_id in (
      select id from public.projects where buyer_id in (
        select id from public.buyers where auth_user_id = auth.uid()
      )
    )
  );

-- Admin full access
create policy "Public read documents"
  on public.project_documents for select using (true);

create policy "Public write documents"
  on public.project_documents for all using (true) with check (true);

-- 5. Full public access on projects for admin operations
create policy "Public read projects"
  on public.projects for select using (true);

create policy "Public write projects"
  on public.projects for all using (true) with check (true);

-- Done.
