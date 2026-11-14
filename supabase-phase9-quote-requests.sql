-- Phase 9: Quote platform requests (replaces the simple quote_leads table for the new Quote Estimator)
-- Run once in Supabase -> SQL Editor.
create table if not exists public.quote_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  phone text not null,
  email text not null,
  ip text,
  qty integer,
  file_kind text,
  analysis jsonb,
  selected_process text,
  overrides jsonb,
  unit_cost numeric,
  total_cost numeric,
  lead_days integer,
  status text not null default 'new',
  paid boolean not null default false
);
create index if not exists quote_requests_phone_idx on public.quote_requests (phone, created_at);
create index if not exists quote_requests_email_idx on public.quote_requests (email, created_at);
create index if not exists quote_requests_ip_idx on public.quote_requests (ip, created_at);

alter table public.quote_requests enable row level security;
-- Inserts are done only by the server (service key), so there is NO anon insert policy.
-- The admin page reads with the public key like the other lead tabs. Harden before the paid launch.
create policy "Read quote requests" on public.quote_requests for select to anon, authenticated using (true);
create policy "Update quote requests" on public.quote_requests for update to anon, authenticated using (true) with check (true);
create policy "Delete quote requests" on public.quote_requests for delete to anon, authenticated using (true);
