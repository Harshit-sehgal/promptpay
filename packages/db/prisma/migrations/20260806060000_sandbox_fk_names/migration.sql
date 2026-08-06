-- WL-075: make the two composite sandbox foreign-key names explicit and
-- PostgreSQL identifier-length safe. The constraints and their definitions
-- remain unchanged; this is metadata-only and forward-only.
ALTER TABLE "sandbox_deposit_simulations"
  RENAME CONSTRAINT "sandbox_deposit_simulations_account_id_user_id_environment_id_f"
  TO "sandbox_deposit_account_fkey";

ALTER TABLE "sandbox_payout_simulations"
  RENAME CONSTRAINT "sandbox_payout_simulations_account_id_user_id_environment_id_fk"
  TO "sandbox_payout_account_fkey";
