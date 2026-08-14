-- x402 settlement audit columns (P0.2). All nullable: dev-mode rows
-- (PAYMENTS_MODE=dev) keep them NULL; x402 rows record the on-chain identity
-- of the payment once the facilitator settles it.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_address text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tx_hash text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS network text;
