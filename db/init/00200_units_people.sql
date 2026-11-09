-- =====================================================================
--  DomusApp · 00200_units_people.sql
--  Filiales (unidades), personas y su relación (propietario, inquilino,
--  residente). Tablas de CONDOMINIO:
--    · condominium_id NOT NULL DEFAULT fn_current_condominium()
--    · RLS: solo se ve y se escribe lo del condominio activo
--    · FK compuestas (condominium_id, x) → (condominium_id, id): un registro
--      jamás referencia datos de otro condominio (las FK ignoran RLS; esto no)
-- =====================================================================

-- --------------------------------------------------------------- Filiales
CREATE TABLE IF NOT EXISTS public.units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,

    code VARCHAR(20) NOT NULL,
    tower VARCHAR(40),
    floor VARCHAR(10),
    kind VARCHAR(20) NOT NULL DEFAULT 'apartment'
        CHECK (kind IN ('house', 'apartment', 'commercial', 'office', 'lot', 'parking', 'storage', 'other')),
    area_m2 NUMERIC(10, 2) CHECK (area_m2 IS NULL OR area_m2 > 0),
    aliquot NUMERIC(9, 6) CHECK (aliquot IS NULL OR (aliquot >= 0 AND aliquot <= 100)),
    occupancy VARCHAR(10) NOT NULL DEFAULT 'owner' CHECK (occupancy IN ('owner', 'rented', 'vacant')),
    notes VARCHAR(500),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_units_code UNIQUE (condominium_id, code),
    CONSTRAINT uq_units_tenant_key UNIQUE (condominium_id, id)
);

COMMENT ON TABLE public.units IS 'Filiales: casas, apartamentos, locales, oficinas, lotes, parqueos y bodegas';
COMMENT ON COLUMN public.units.code IS 'Número o código de la filial (A-101, Casa 12, Local 5)';
COMMENT ON COLUMN public.units.tower IS 'Torre, bloque, etapa o edificio';
COMMENT ON COLUMN public.units.kind IS 'house, apartment, commercial (local), office, lot, parking, storage, other';
COMMENT ON COLUMN public.units.aliquot IS 'Alícuota o coeficiente de copropiedad (%): reparte cuotas y votos';
COMMENT ON COLUMN public.units.occupancy IS 'owner = la habita el propietario, rented = alquilada, vacant = desocupada';

CREATE INDEX IF NOT EXISTS idx_units_tower ON public.units (condominium_id, tower, code);

CREATE TRIGGER trg_units_updated_at BEFORE UPDATE ON public.units
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_units AFTER INSERT OR UPDATE OR DELETE ON public.units
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Personas
CREATE TABLE IF NOT EXISTS public.people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,

    names VARCHAR(120) NOT NULL,
    id_number VARCHAR(30),
    email CITEXT,
    phone VARCHAR(30),
    notes VARCHAR(500),
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_people_tenant_key UNIQUE (condominium_id, id)
);

COMMENT ON TABLE public.people IS 'Personas del condominio: propietarios, inquilinos y residentes';
COMMENT ON COLUMN public.people.id_number IS 'Documento de identidad (su nombre depende del país: Cédula, DNI, CURP…)';
COMMENT ON COLUMN public.people.email IS 'Correo; con él se le da acceso a la app';
COMMENT ON COLUMN public.people.user_id IS 'Cuenta de DomusApp de la persona, si se le dio acceso';

CREATE UNIQUE INDEX IF NOT EXISTS uq_people_id_number ON public.people (condominium_id, id_number) WHERE id_number IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_people_email ON public.people (condominium_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_people_user ON public.people (condominium_id, user_id) WHERE user_id IS NOT NULL;

CREATE TRIGGER trg_people_updated_at BEFORE UPDATE ON public.people
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_people AFTER INSERT OR UPDATE OR DELETE ON public.people
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Filial ↔ persona
CREATE TABLE IF NOT EXISTS public.units_people (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,

    unit_id UUID NOT NULL,
    person_id UUID NOT NULL,
    relation VARCHAR(10) NOT NULL CHECK (relation IN ('owner', 'tenant', 'resident')),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_units_people UNIQUE (unit_id, person_id),
    CONSTRAINT fk_units_people_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units (condominium_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_units_people_person FOREIGN KEY (condominium_id, person_id)
        REFERENCES public.people (condominium_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.units_people IS 'Quién está vinculado a cada filial y cómo';
COMMENT ON COLUMN public.units_people.relation IS 'owner = propietario, tenant = inquilino, resident = residente (familiar, otro ocupante)';
COMMENT ON COLUMN public.units_people.is_primary IS 'Contacto principal y responsable de pago de la filial (uno por filial)';

CREATE UNIQUE INDEX IF NOT EXISTS uq_units_people_primary ON public.units_people (unit_id) WHERE is_primary;
CREATE INDEX IF NOT EXISTS idx_units_people_person ON public.units_people (person_id);

CREATE TRIGGER trg_audit_units_people AFTER INSERT OR UPDATE OR DELETE ON public.units_people
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Aislamiento por condominio
ALTER TABLE public.units        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.people       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units_people ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_units_condominium ON public.units
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_people_condominium ON public.people
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_units_people_condominium ON public.units_people
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
