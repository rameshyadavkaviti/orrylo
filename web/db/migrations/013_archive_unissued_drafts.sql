-- Reversible draft removal: keep ledger and ownership evidence, hide archived drafts.
ALTER TABLE public.project_profiles
  ADD COLUMN deleted_at timestamptz;
CREATE INDEX project_profiles_active_idx
  ON public.project_profiles (project_id) WHERE deleted_at IS NULL;
GRANT UPDATE (deleted_at) ON public.project_profiles TO orrylo_app;
