-- =====================================================================
--  DomusApp · 00001_base_functions.sql
--  Funciones utilitarias compartidas por todas las tablas.
--
--  Contexto de la petición: la API abre cada transacción fijando con
--  set_config(..., true) (alcance de transacción):
--    app.user_id         → usuario que hace el cambio (auditoría)
--    app.trace_id        → petición HTTP que lo originó
--    app.condominium_id  → condominio activo (aislamiento por RLS)
-- =====================================================================

-- Mantiene updated_at al día en cada UPDATE (se engancha con un trigger por tabla).
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.fn_set_updated_at() IS 'Trigger BEFORE UPDATE: actualiza updated_at con la hora actual';

CREATE OR REPLACE FUNCTION public.fn_current_app_user()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION public.fn_current_app_user() IS 'Usuario de DomusApp fijado por la API en la transacción (app.user_id), o NULL';

-- Condominio activo. Las tablas de negocio llevan condominium_id y una política RLS
-- "condominium_id = fn_current_condominium()": sin condominio fijado no se ve ni se escribe nada.
CREATE OR REPLACE FUNCTION public.fn_current_condominium()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
    SELECT NULLIF(current_setting('app.condominium_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION public.fn_current_condominium() IS 'Condominio activo fijado por la API (app.condominium_id), o NULL';
