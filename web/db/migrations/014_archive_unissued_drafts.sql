-- Reversible draft removal: keep ledger and ownership evidence, hide archived drafts.
-- Reconcile deployments where the archive column/index were installed before
-- migration tracking; never rewrite the registered 013 Mainnet migration.
ALTER TABLE public.project_profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS project_profiles_active_idx
  ON public.project_profiles (project_id) WHERE deleted_at IS NULL;
GRANT UPDATE (deleted_at) ON public.project_profiles TO orrylo_app;
