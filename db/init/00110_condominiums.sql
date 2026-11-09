-- =====================================================================
--  DomusApp · 00110_condominiums.sql
--  Condominios (tenants) y pertenencia de usuarios a cada uno.
--
--  Una sola BD compartida: cada fila de negocio lleva condominium_id y
--  Postgres la aísla con RLS según app.condominium_id (fn_current_condominium).
--  condominiums y users_condominiums NO tienen RLS: la API filtra por
--  pertenencia (un usuario ve solo los condominios a los que pertenece).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.condominiums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]+$'),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    kind VARCHAR(20) NOT NULL DEFAULT 'condominium'
        CHECK (kind IN ('condominium', 'residential', 'commercial', 'office')),
    name VARCHAR(120) NOT NULL,
    legal_name VARCHAR(160),
    tax_id VARCHAR(30),

    country_code CHAR(2) NOT NULL REFERENCES public.catalogs_countries(code),
    currency_code CHAR(3) NOT NULL REFERENCES public.catalogs_currencies(code),
    timezone VARCHAR(60) NOT NULL,

    address VARCHAR(400),
    city VARCHAR(80),
    state VARCHAR(80),
    phone VARCHAR(30),
    email VARCHAR(200),
    brand_color VARCHAR(7) CHECK (brand_color ~ '^#[0-9a-fA-F]{6}$'),

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.condominiums IS 'Condominios, residenciales, centros comerciales y oficentros (cada uno aislado por RLS)';
COMMENT ON COLUMN public.condominiums.id IS 'Identificador (valor de app.condominium_id)';
COMMENT ON COLUMN public.condominiums.code IS 'Código corto';
COMMENT ON COLUMN public.condominiums.is_active IS 'Activo. Un condominio suspendido no admite sesiones';
COMMENT ON COLUMN public.condominiums.kind IS 'condominium, residential, commercial (centro comercial), office (oficentro)';
COMMENT ON COLUMN public.condominiums.tax_id IS 'Identificación tributaria (su nombre depende del país)';
COMMENT ON COLUMN public.condominiums.currency_code IS 'Moneda en que se cobran cuotas y se muestran montos';
COMMENT ON COLUMN public.condominiums.timezone IS 'Zona horaria IANA: fechas y horas de accesos, reservas y alertas';
COMMENT ON COLUMN public.condominiums.brand_color IS 'Color de marca del condominio en panel, app y correos';

CREATE TRIGGER trg_condominiums_updated_at BEFORE UPDATE ON public.condominiums
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_condominiums AFTER INSERT OR UPDATE OR DELETE ON public.condominiums
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- La zona horaria debe existir en Postgres (la API también la valida).
CREATE OR REPLACE FUNCTION public.fn_check_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone) THEN
        RAISE EXCEPTION 'Zona horaria desconocida: %', NEW.timezone;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_condominiums_timezone BEFORE INSERT OR UPDATE OF timezone ON public.condominiums
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_timezone();

-- Zona horaria del condominio: la API la fija en cada consulta, así now() y CURRENT_DATE son locales.
CREATE OR REPLACE FUNCTION public.fn_condominium_timezone(p_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT timezone FROM public.condominiums WHERE id = p_id;
$$;

-- --------------------------------------------------------------- Pertenencia
CREATE TABLE IF NOT EXISTS public.users_condominiums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    condominium_id UUID NOT NULL REFERENCES public.condominiums(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL REFERENCES public.catalogs_roles(slug),
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_users_condominiums UNIQUE (user_id, condominium_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_users_condominiums_default ON public.users_condominiums (user_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS idx_users_condominiums_condominium ON public.users_condominiums (condominium_id, role);

COMMENT ON TABLE public.users_condominiums IS 'Pertenencia de un usuario a un condominio, con su rol en él';
COMMENT ON COLUMN public.users_condominiums.role IS 'admin, owner (propietario), tenant (inquilino) o guard (guarda)';
COMMENT ON COLUMN public.users_condominiums.is_default IS 'Condominio con el que abre sesión (uno por usuario)';
COMMENT ON COLUMN public.users_condominiums.is_active IS 'Acceso activo. Inactivo = no puede entrar a ese condominio';

CREATE TRIGGER trg_users_condominiums_updated_at BEFORE UPDATE ON public.users_condominiums
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_users_condominiums AFTER INSERT OR UPDATE OR DELETE ON public.users_condominiums
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();
