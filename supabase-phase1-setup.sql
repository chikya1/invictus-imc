-- ============================================================
-- INVICTUS IMC — Phase 1 Auth Setup
-- Run this entire script in Supabase > SQL Editor > New Query
-- ============================================================

-- 1. PROFILES TABLE
-- Links auth.users to a role and their club record
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  role text not null check (role in ('buyer', 'manufacturer', 'admin')),
  club_record_id uuid, -- references the buyers or manufacturers table row
  full_name text,
  company_name text,
  email text,
  created_at timestamptz default now()
);

-- 2. ENABLE ROW LEVEL SECURITY
alter table public.profiles enable row level security;

-- 3. RLS POLICIES

-- Users can read their own profile only
create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Users can update their own profile
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Admin can read all profiles (we'll use service role for admin operations)
-- For now, anon/authenticated users only see their own row

-- 4. FUNCTION: auto-create profile on signup
-- This fires when a new auth user is created
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role, full_name, company_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'buyer'),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'company_name', '')
  );
  return new;
end;
$$ language plpgsql security definer;

-- 5. TRIGGER: fires the function on every new user
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 6. UPDATE buyers and manufacturers tables to track auth status
alter table public.buyers 
  add column if not exists auth_user_id uuid references auth.users(id),
  add column if not exists portal_access boolean default false;

alter table public.manufacturers
  add column if not exists auth_user_id uuid references auth.users(id),
  add column if not exists portal_access boolean default false;

-- 7. RLS on buyers — users can only see their own row
alter table public.buyers enable row level security;

create policy "Buyers can read own record"
  on public.buyers for select
  using (auth.uid() = auth_user_id);

-- 8. RLS on manufacturers — users can only see their own row  
alter table public.manufacturers enable row level security;

create policy "Manufacturers can read own record"
  on public.manufacturers for select
  using (auth.uid() = auth_user_id);

-- Done. Confirm by checking: Table Editor > profiles
