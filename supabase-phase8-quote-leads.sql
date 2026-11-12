-- Phase 8: Quote Estimator leads
-- Run this once in Supabase -> SQL Editor.
create table if not exists public.quote_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  product text not null,
  quantity integer not null check (quantity > 0),
  city text,
  inputs jsonb not null,
  unit_cost numeric,
  total_cost numeric,
  name text not null,
  company text,
  phone text not null,
  email text not null,
  status text not null default 'new'
);

alter table public.quote_leads enable row level security;

-- Anyone visiting the site can submit a quote lead.
create policy "Public can insert quote leads"
  on public.quote_leads for insert to anon, authenticated
  with check (status = 'new');

-- Admin page reads with the same public key as the other lead tabs (impressions).
-- NOTE: this matches how Buyer Leads work today. See hardening note in the chat.
create policy "Read quote leads"
  on public.quote_leads for select to anon, authenticated using (true);

create policy "Update quote lead status"
  on public.quote_leads for update to anon, authenticated using (true) with check (true);

create policy "Delete quote leads"
  on public.quote_leads for delete to anon, authenticated using (true);
