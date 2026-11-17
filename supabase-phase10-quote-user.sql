-- Phase 10: link quote requests to app users (Estima app). Run once in Supabase -> SQL Editor.
alter table public.quote_requests add column if not exists user_id uuid;
create index if not exists quote_requests_user_idx on public.quote_requests (user_id, created_at);
