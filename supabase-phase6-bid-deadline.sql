-- Phase 6: Optional bid deadline on orders
-- Run this once in Supabase SQL Editor before deploying the updated files

ALTER TABLE manufacturing_orders ADD COLUMN IF NOT EXISTS bid_deadline timestamptz;
-- NULL = no deadline, stays open until manually closed/awarded.
-- If set, treat the order as closed for new bids once this timestamp passes,
-- even if status is still 'open' in the database.
