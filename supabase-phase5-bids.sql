-- Phase 5: Bid close-looping (status tracking, archive, award)
-- Run this once in Supabase SQL Editor before deploying the updated admin.html

ALTER TABLE order_bids ADD COLUMN IF NOT EXISTS status text DEFAULT 'submitted';
-- status values: 'submitted' (default), 'shortlisted', 'awarded', 'rejected'

ALTER TABLE order_bids ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

ALTER TABLE order_bids ADD COLUMN IF NOT EXISTS awarded_at timestamptz;
