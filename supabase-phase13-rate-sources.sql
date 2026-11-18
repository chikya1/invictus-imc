-- Phase 13: sources for live rates + a log of every refresh. Run once in Supabase -> SQL Editor.
-- Only the server can read or change these tables (no public access).

create table if not exists public.rate_sources (
  id text primary key,
  name text not null,
  url text,
  kind text not null default 'json_api',          -- json_api | html_anchor
  terms_status text not null default 'unchecked', -- unchecked | permitted | forbidden. Only 'permitted' sources are ever fetched.
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,      -- the list of rates to read from this source (see api/_rate-fetch.js)
  notes text,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_status text,
  last_message text,
  last_alert_at timestamptz
);

create table if not exists public.rate_source_runs (
  id bigserial primary key,
  source_id text not null,
  run_at timestamptz not null default now(),
  status text not null,   -- ok | failed | blocked | format_changed | out_of_range
  message text,
  values_read jsonb
);
create index if not exists rate_source_runs_idx on public.rate_source_runs (source_id, run_at desc);

alter table public.rate_sources enable row level security;
alter table public.rate_source_runs enable row level security;

-- Starting list. Everything is OFF until the terms of that source are checked and its settings are filled in.
insert into public.rate_sources (id, name, url, kind, terms_status, enabled, notes) values
  ('metals_mcx', 'Non-ferrous metals (MCX based)', null, 'json_api', 'unchecked', false,
   'Copper, aluminium, zinc, nickel, lead. Needs a licensed data feed. A free aggregator site was checked and its terms forbid scraping.'),
  ('rubber_board', 'Rubber Board of India daily prices', null, 'html_anchor', 'unchecked', false,
   'Natural rubber RSS4, RSS5, ISNR20, latex. Government site. Page and terms still to be checked.'),
  ('polymers_ofb', 'Polymer prices (OfBusiness)', 'https://www.ofbusiness.com/products/polymers_packaging', 'html_anchor', 'unchecked', false,
   'Shows ranges publicly but many prices are behind a login. Needs written permission or a data partnership first.')
on conflict (id) do nothing;
