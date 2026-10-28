-- Phase 7: Pricing rules (admin-editable) + payments ledger
-- Run once in Supabase SQL Editor BEFORE deploying the payment code.

-- 1) Pricing rules. One row per tier, per action.
--    action: 'manufacturer_bid' (manufacturer places a new bid) | 'buyer_order' (buyer posts a new order)
--    from_n: this price applies from the user's Nth use of that action onward (until the next tier).
--    price: in rupees. 0 = free.
CREATE TABLE IF NOT EXISTS pricing_rules (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  from_n integer NOT NULL DEFAULT 1 CHECK (from_n >= 1),
  price numeric NOT NULL DEFAULT 0 CHECK (price >= 0),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (action, from_n)
);

-- Everything starts FREE, so nothing changes for anyone until you edit prices in Admin.
INSERT INTO pricing_rules (action, from_n, price) VALUES
  ('manufacturer_bid', 1, 0),
  ('buyer_order', 1, 0)
ON CONFLICT (action, from_n) DO NOTHING;

ALTER TABLE pricing_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pricing_rules anon all" ON pricing_rules;
CREATE POLICY "pricing_rules anon all" ON pricing_rules FOR ALL TO anon USING (true) WITH CHECK (true);

-- 2) Payments ledger. Only the server (service role key) can touch this - no anon policy on purpose.
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  user_id text NOT NULL,
  order_ref text,
  amount_paise integer NOT NULL,
  razorpay_order_id text UNIQUE NOT NULL,
  razorpay_payment_id text,
  status text NOT NULL DEFAULT 'created',   -- created | paid
  created_at timestamptz DEFAULT now(),
  paid_at timestamptz
);
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

-- 3) Link paid actions back to their payment
ALTER TABLE order_bids ADD COLUMN IF NOT EXISTS payment_id uuid;
ALTER TABLE order_bids ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0;
ALTER TABLE manufacturing_orders ADD COLUMN IF NOT EXISTS payment_id uuid;
ALTER TABLE manufacturing_orders ADD COLUMN IF NOT EXISTS amount_paid numeric DEFAULT 0;
