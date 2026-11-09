-- =====================================================================
--  DomusApp · 20261109_0001_access_control.sql  (Fase 2)
--  Control de acceso:
--    · files           imágenes subidas (logo del condominio, fotos de autorizados)
--    · vehicles        vehículos de cada filial
--    · authorizations  autorizados temporales, permanentes y empleados
--    · access_logs     bitácora de ingresos y salidas de la caseta
--  Todas son tablas de CONDOMINIO (RLS por condominium_id, FK compuestas).
-- =====================================================================

-- --------------------------------------------------------------- Archivos
CREATE TABLE IF NOT EXISTS public.files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,

    purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('condominium_logo', 'authorization_photo')),
    storage_key VARCHAR(80) NOT NULL UNIQUE,
    mime_type VARCHAR(40) NOT NULL,
    size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
    width INTEGER,
    height INTEGER,
    variants TEXT[] NOT NULL DEFAULT '{}',
    sha256 CHAR(64) NOT NULL,
    original_name VARCHAR(200),
    original_mime VARCHAR(60),
    original_bytes INTEGER,

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_files_tenant_key UNIQUE (condominium_id, id)
);

COMMENT ON TABLE public.files IS 'Imágenes subidas. El contenido vive en el volumen uploads (<condominio>/<archivo>/<variante>); se entrega con URL firmada';
COMMENT ON COLUMN public.files.storage_key IS '<condominium_id>/<file_id>: carpeta con las variantes re-codificadas (sin EXIF)';

ALTER TABLE public.condominiums
    ADD COLUMN IF NOT EXISTS logo_file_id UUID REFERENCES public.files(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.condominiums.logo_file_id IS 'Logo del condominio (cabecera del panel, app y correos)';

-- --------------------------------------------------------------- Vehículos
CREATE TABLE IF NOT EXISTS public.vehicles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL,

    plate VARCHAR(15) NOT NULL CHECK (plate ~ '^[A-Z0-9]{2,15}$'),
    kind VARCHAR(12) NOT NULL DEFAULT 'car' CHECK (kind IN ('car', 'motorcycle', 'truck', 'bicycle', 'other')),
    brand VARCHAR(40),
    model VARCHAR(40),
    color VARCHAR(30),
    notes VARCHAR(300),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_vehicles_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_vehicles_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.vehicles IS 'Vehículos registrados de cada filial (el guarda los reconoce por la placa)';
COMMENT ON COLUMN public.vehicles.plate IS 'Placa normalizada: mayúsculas, sin espacios ni guiones';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_plate ON public.vehicles (condominium_id, plate) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_vehicles_unit ON public.vehicles (condominium_id, unit_id);

CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON public.vehicles
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_vehicles AFTER INSERT OR UPDATE OR DELETE ON public.vehicles
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Autorizados
CREATE TABLE IF NOT EXISTS public.authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL,

    kind VARCHAR(10) NOT NULL CHECK (kind IN ('temporary', 'permanent', 'employee')),
    names VARCHAR(120) NOT NULL,
    id_number VARCHAR(30),
    plate VARCHAR(15) CHECK (plate IS NULL OR plate ~ '^[A-Z0-9]{2,15}$'),
    occupation VARCHAR(60),
    photo_file_id UUID REFERENCES public.files(id) ON DELETE SET NULL,

    valid_from DATE,
    valid_to DATE,
    weekdays SMALLINT[],
    time_from TIME,
    time_to TIME,

    call_to_confirm BOOLEAN NOT NULL DEFAULT FALSE,
    delete_after_use BOOLEAN NOT NULL DEFAULT FALSE,
    instructions VARCHAR(500),

    status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'used', 'revoked')),
    last_entry_at TIMESTAMPTZ,
    last_exit_at TIMESTAMPTZ,

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_authorizations_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_authorizations_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_authorizations_range CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
    CONSTRAINT ck_authorizations_temporary CHECK (kind <> 'temporary' OR (valid_from IS NOT NULL AND valid_to IS NOT NULL)),
    CONSTRAINT ck_authorizations_weekdays CHECK (weekdays IS NULL OR weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[]),
    CONSTRAINT ck_authorizations_hours CHECK ((time_from IS NULL) = (time_to IS NULL))
);

COMMENT ON TABLE public.authorizations IS 'Personas autorizadas a ingresar a una filial: temporales (fecha o rango), permanentes y empleados (días y horario)';
COMMENT ON COLUMN public.authorizations.weekdays IS 'Días ISO permitidos (1 = lunes … 7 = domingo); NULL = todos';
COMMENT ON COLUMN public.authorizations.call_to_confirm IS 'El guarda debe llamar a la filial para confirmar antes de dejar pasar';
COMMENT ON COLUMN public.authorizations.delete_after_use IS 'Al registrar el ingreso, el permiso queda «utilizado» y deja de valer';
COMMENT ON COLUMN public.authorizations.instructions IS 'Indicaciones para el oficial de seguridad';
COMMENT ON COLUMN public.authorizations.status IS 'active, used (se usó y era de un solo uso) o revoked (lo eliminó el residente o la administración)';

CREATE INDEX IF NOT EXISTS idx_authorizations_unit ON public.authorizations (condominium_id, unit_id, kind);
CREATE INDEX IF NOT EXISTS idx_authorizations_active ON public.authorizations (condominium_id, valid_from, valid_to) WHERE status = 'active';

CREATE TRIGGER trg_authorizations_updated_at BEFORE UPDATE ON public.authorizations
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_authorizations AFTER INSERT OR UPDATE OR DELETE ON public.authorizations
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Bitácora de acceso
CREATE TABLE IF NOT EXISTS public.access_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL,
    authorization_id UUID REFERENCES public.authorizations(id) ON DELETE SET NULL,
    vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,

    kind VARCHAR(12) NOT NULL
        CHECK (kind IN ('temporary', 'permanent', 'employee', 'resident', 'unannounced', 'delivery', 'service')),
    names VARCHAR(120) NOT NULL,
    id_number VARCHAR(30),
    plate VARCHAR(15),
    notes VARCHAR(500),

    status VARCHAR(10) NOT NULL CHECK (status IN ('pending', 'inside', 'exited', 'denied')),
    response VARCHAR(10) CHECK (response IN ('approved', 'denied')),
    responded_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    responded_at TIMESTAMPTZ,

    entry_at TIMESTAMPTZ,
    exit_at TIMESTAMPTZ,
    entry_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    exit_by UUID REFERENCES public.users(id) ON DELETE SET NULL,

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_access_logs_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_access_logs_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_access_logs_exit CHECK (exit_at IS NULL OR (entry_at IS NOT NULL AND exit_at >= entry_at)),
    CONSTRAINT ck_access_logs_inside CHECK (status <> 'inside' OR entry_at IS NOT NULL)
);

COMMENT ON TABLE public.access_logs IS 'Bitácora de la caseta: cada ingreso (y su salida) con quién, a qué filial, cuándo y qué guarda lo registró';
COMMENT ON COLUMN public.access_logs.status IS 'pending = visita no anunciada esperando respuesta del residente; inside; exited; denied';
COMMENT ON COLUMN public.access_logs.response IS 'Respuesta del residente a una visita no anunciada';

CREATE INDEX IF NOT EXISTS idx_access_logs_time ON public.access_logs (condominium_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_open ON public.access_logs (condominium_id, status) WHERE status IN ('pending', 'inside');
CREATE INDEX IF NOT EXISTS idx_access_logs_unit ON public.access_logs (condominium_id, unit_id, created_at DESC);

-- --------------------------------------------------------------- RLS
ALTER TABLE public.files          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.access_logs    ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_files_condominium ON public.files
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_vehicles_condominium ON public.vehicles
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_authorizations_condominium ON public.authorizations
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_access_logs_condominium ON public.access_logs
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());

-- La bitácora no se borra desde la app (solo se registra la salida o la respuesta)
REVOKE DELETE, TRUNCATE ON public.access_logs FROM :"app_user";

-- --------------------------------------------------------------- Módulo y permisos
UPDATE public.catalogs_modules SET is_offline = FALSE WHERE code = 'ACCESS';

UPDATE public.catalogs_roles
   SET permissions = permissions || '{"ACCESS": ["access", "view", "add_new", "edit", "delete", "download"]}'::jsonb
 WHERE slug = 'admin';
