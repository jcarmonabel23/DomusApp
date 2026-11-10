-- =====================================================================
--  DomusApp · 20261115_0001_reports.sql  (Fase 8)
--  Reportes y tablero:
--    · módulo REPORTS en línea con permisos para el administrador (ver y exportar)
--    · índices por fecha para los indicadores de un período (cobros, cargos, ingresos, casos, reservas)
--  Los indicadores se calculan al vuelo sobre las tablas existentes: no hay tablas nuevas.
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_access_logs_entry ON public.access_logs (condominium_id, entry_at) WHERE entry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_paid_on ON public.payments (condominium_id, paid_on) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_charges_due ON public.charges (condominium_id, due_date) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cases_created ON public.cases (condominium_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cases_resolved ON public.cases (condominium_id, resolved_at) WHERE resolved_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_starts ON public.bookings (condominium_id, starts_at);

UPDATE public.catalogs_modules SET is_offline = FALSE WHERE code = 'REPORTS';

UPDATE public.catalogs_roles
   SET permissions = permissions || '{"REPORTS": ["access", "view", "download"]}'::jsonb
 WHERE slug = 'admin';
