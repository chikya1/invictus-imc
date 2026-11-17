-- Phase 12: central rates. Run once in Supabase -> SQL Editor. Safe to run again (it never overwrites edited rates).

create table if not exists public.rate_materials (
  key text primary key,
  label text not null,
  family text not null,              -- metal | plastic (rubber and glass will be added later)
  density numeric not null,          -- g per cm3
  rate_inr_kg numeric not null,      -- raw material price, INR per kg
  removal_cm3_min numeric not null,  -- machining speed, cm3 per minute
  source text not null default 'placeholder',
  source_url text,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.rate_settings (
  key text primary key,
  label text not null,
  value numeric not null,
  unit text,
  grp text,                          -- machine | labour | cost | print
  source text not null default 'placeholder',
  source_url text,
  updated_at timestamptz not null default now()
);

-- Every change is kept with its date, so rates can be compared over time.
create table if not exists public.rate_history (
  id bigserial primary key,
  kind text not null,                -- material | setting
  key text not null,
  value numeric not null,
  source text,
  changed_at timestamptz not null default now()
);
create index if not exists rate_history_key_idx on public.rate_history (kind, key, changed_at);

create or replace function public.log_rate_material() returns trigger language plpgsql as $$
begin
  insert into public.rate_history (kind, key, value, source) values ('material', new.key, new.rate_inr_kg, new.source);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_rate_materials on public.rate_materials;
create trigger trg_rate_materials before insert or update of rate_inr_kg on public.rate_materials
  for each row execute function public.log_rate_material();

create or replace function public.log_rate_setting() returns trigger language plpgsql as $$
begin
  insert into public.rate_history (kind, key, value, source) values ('setting', new.key, new.value, new.source);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_rate_settings on public.rate_settings;
create trigger trg_rate_settings before insert or update of value on public.rate_settings
  for each row execute function public.log_rate_setting();

-- Everyone may READ rates (a public Market Rates page comes later). Only the server can change them.
alter table public.rate_materials enable row level security;
alter table public.rate_settings enable row level security;
alter table public.rate_history enable row level security;
drop policy if exists "rate_materials read" on public.rate_materials;
create policy "rate_materials read" on public.rate_materials for select to anon, authenticated using (true);
drop policy if exists "rate_settings read" on public.rate_settings;
create policy "rate_settings read" on public.rate_settings for select to anon, authenticated using (true);
drop policy if exists "rate_history read" on public.rate_history;
create policy "rate_history read" on public.rate_history for select to anon, authenticated using (true);

-- Starting values (the same numbers the quote engine used before). They are placeholders until live sources are connected.
insert into public.rate_materials (key, label, family, density, rate_inr_kg, removal_cm3_min) values
  ('mild_steel', 'Mild steel', 'metal', 7.85, 70, 12),
  ('alloy_steel', 'Alloy / tool steel', 'metal', 7.85, 130, 8),
  ('stainless_304', 'Stainless steel 304', 'metal', 8, 260, 5),
  ('stainless_316', 'Stainless steel 316', 'metal', 8, 380, 4),
  ('aluminium', 'Aluminium (6061 type)', 'metal', 2.7, 290, 40),
  ('brass', 'Brass', 'metal', 8.5, 650, 35),
  ('copper', 'Copper', 'metal', 8.9, 900, 25),
  ('cast_iron', 'Cast iron', 'metal', 7.2, 65, 14),
  ('zinc_alloy', 'Zinc alloy', 'metal', 6.7, 330, 40),
  ('titanium', 'Titanium', 'metal', 4.5, 2500, 2),
  ('abs', 'ABS', 'plastic', 1.05, 170, 60),
  ('pp', 'Polypropylene (PP)', 'plastic', 0.91, 115, 60),
  ('hdpe', 'HDPE', 'plastic', 0.95, 110, 60),
  ('pc', 'Polycarbonate (PC)', 'plastic', 1.2, 260, 50),
  ('pa6', 'Nylon (PA6)', 'plastic', 1.14, 280, 50),
  ('pom', 'Acetal (POM)', 'plastic', 1.41, 320, 60),
  ('pvc', 'PVC', 'plastic', 1.4, 95, 60),
  ('tpu', 'TPU (soft)', 'plastic', 1.2, 330, 40),
  ('pet', 'PET', 'plastic', 1.38, 120, 60)
on conflict (key) do nothing;

insert into public.rate_settings (key, label, value, unit, grp) values
  ('cnc_rate_metal', 'CNC machine rate, metal', 1100, 'INR/hour', 'machine'),
  ('cnc_rate_plastic', 'CNC machine rate, plastic', 900, 'INR/hour', 'machine'),
  ('laser_rate', 'Laser cutting rate', 1800, 'INR/hour', 'machine'),
  ('press_rate', 'Press rate', 1000, 'INR/hour', 'machine'),
  ('cnc_setup', 'CNC setup and programming', 4000, 'INR', 'machine'),
  ('cnc_setup_per_complexity', 'CNC setup, extra per complexity step', 1800, 'INR', 'machine'),
  ('stock_block_premium_plastic', 'Plastic stock block premium', 2.2, 'x', 'cost'),
  ('labour_per_piece.cnc', 'Labour per piece, cnc', 15, 'INR/pc', 'labour'),
  ('labour_per_piece.sheet', 'Labour per piece, sheet', 10, 'INR/pc', 'labour'),
  ('labour_per_piece.casting', 'Labour per piece, casting', 20, 'INR/pc', 'labour'),
  ('labour_per_piece.forging', 'Labour per piece, forging', 15, 'INR/pc', 'labour'),
  ('labour_per_piece.extrusion', 'Labour per piece, extrusion', 6, 'INR/pc', 'labour'),
  ('labour_per_piece.print', 'Labour per piece, print', 40, 'INR/pc', 'labour'),
  ('labour_per_piece.injection', 'Labour per piece, injection', 1.5, 'INR/pc', 'labour'),
  ('labour_per_piece.vacuum', 'Labour per piece, vacuum', 150, 'INR/pc', 'labour'),
  ('labour_per_piece.blow', 'Labour per piece, blow', 2, 'INR/pc', 'labour'),
  ('labour_per_piece.pcb', 'Labour per piece, pcb', 4, 'INR/pc', 'labour'),
  ('packaging', 'Packaging', 5, 'INR/pc', 'cost'),
  ('transport', 'Transport', 4, 'INR/pc', 'cost'),
  ('margin_pct', 'Manufacturer margin', 15, '%', 'cost'),
  ('inr_cm3_metal_print', '3D printing, metal', 350, 'INR/cm3', 'print'),
  ('inr_cm3_titanium_print', '3D printing, titanium', 700, 'INR/cm3', 'print'),
  ('inr_cm3_plastic_print', '3D printing, plastic', 22, 'INR/cm3', 'print')
on conflict (key) do nothing;
