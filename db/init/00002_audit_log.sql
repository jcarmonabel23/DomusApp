-- =====================================================================
--  DomusApp · 00002_audit_log.sql
--  Auditoría de datos: un trigger genérico guarda old/new en JSONB con el
--  usuario (app.user_id), el trace id (app.trace_id) y el condominio.
--  La app solo puede INSERT/SELECT aquí (ver 99999_app_role.sh).
--  Cada tabla se engancha con: AFTER INSERT OR UPDATE OR DELETE … fn_audit()
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
    id BIGSERIAL PRIMARY KEY,

    table_name VARCHAR(80) NOT NULL,
    record_id VARCHAR(80),
    action CHAR(1) NOT NULL CHECK (action IN ('I', 'U', 'D')),

    old_data JSONB,
    new_data JSONB,
    changed_fields TEXT[],

    user_id UUID,
    trace_id UUID,
    condominium_id UUID,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.audit_log IS 'Auditoría de cambios en datos de negocio y seguridad (quién, qué, cuándo, antes/después)';
COMMENT ON COLUMN public.audit_log.table_name IS 'Tabla modificada';
COMMENT ON COLUMN public.audit_log.record_id IS 'Id del registro modificado';
COMMENT ON COLUMN public.audit_log.action IS 'I = alta, U = modificación, D = baja';
COMMENT ON COLUMN public.audit_log.old_data IS 'Valores anteriores (sin columnas sensibles)';
COMMENT ON COLUMN public.audit_log.new_data IS 'Valores nuevos (sin columnas sensibles)';
COMMENT ON COLUMN public.audit_log.changed_fields IS 'Columnas que cambiaron (solo en U)';
COMMENT ON COLUMN public.audit_log.user_id IS 'Usuario que hizo el cambio (app.user_id)';
COMMENT ON COLUMN public.audit_log.trace_id IS 'Trace id de la petición (app.trace_id)';
COMMENT ON COLUMN public.audit_log.condominium_id IS 'Condominio del registro (NULL en tablas globales)';

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON public.audit_log (table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_condominium ON public.audit_log (condominium_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON public.audit_log (created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_ignored TEXT[] := ARRAY['password_hash', 'failed_attempts', 'locked_until', 'logins',
                              'last_login_at', 'updated_at'];
    v_old JSONB;
    v_new JSONB;
    v_changed TEXT[];
    v_key TEXT;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        v_old := to_jsonb(OLD);
        FOREACH v_key IN ARRAY v_ignored LOOP v_old := v_old - v_key; END LOOP;
    END IF;
    IF TG_OP IN ('UPDATE', 'INSERT') THEN
        v_new := to_jsonb(NEW);
        FOREACH v_key IN ARRAY v_ignored LOOP v_new := v_new - v_key; END LOOP;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(n.key ORDER BY n.key)
          INTO v_changed
          FROM jsonb_each(v_new) n
         WHERE n.value IS DISTINCT FROM v_old -> n.key;
        IF v_changed IS NULL THEN
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, changed_fields, user_id, trace_id, condominium_id)
    VALUES (
        TG_TABLE_NAME,
        COALESCE(v_new ->> 'id', v_old ->> 'id'),
        LEFT(TG_OP, 1),
        v_old,
        v_new,
        v_changed,
        public.fn_current_app_user(),
        NULLIF(current_setting('app.trace_id', true), '')::uuid,
        COALESCE(v_new ->> 'condominium_id', v_old ->> 'condominium_id',
                 CASE WHEN TG_TABLE_NAME = 'condominiums' THEN COALESCE(v_new ->> 'id', v_old ->> 'id') END)::uuid
    );

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.fn_audit() IS 'Trigger genérico de auditoría: registra old/new, columnas cambiadas, usuario, trace id y condominio';
