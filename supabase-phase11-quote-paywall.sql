-- Phase 11: paywall for instant quotes. Run once in Supabase -> SQL Editor.
-- Rule: the price applies from the person's Nth quote onward.
-- Here: quotes 1 to 3 are free, quote 4 onward costs Rs 20. Change the numbers any time (edit the rows).
insert into public.pricing_rules (action, from_n, price) values
  ('quote_analysis', 1, 0),
  ('quote_analysis', 4, 20)
on conflict (action, from_n) do update set price = excluded.price, updated_at = now();
