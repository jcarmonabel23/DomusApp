-- =====================================================================
--  DomusApp · 20261113_0001_bookings.sql  (Fase 6)
--  Áreas comunes y reservaciones:
--    · amenities        áreas con foto, reglamento, horario, duración máxima, anticipación, capacidad y costo
--    · amenity_blocks   feriados, cierres (no disponible) y restricciones por filial, de un área o de todas
--    · bookings         reservaciones (pendiente → aprobada / rechazada; cancelada)
--
--  Modos de un área:
--    exclusive = un solo grupo a la vez (rancho, salón): un horario reservado no admite otra reserva.
--    shared    = varios a la vez hasta la capacidad en personas (piscina, gimnasio).
--  Con costo, al quedar aprobada la reserva se carga a la filial (charges, tipo 'special'); si se cancela
--  con la anticipación del área (o la cancela la administración), el cargo se anula.
--  Las reservas no se borran: se cancelan o se rechazan con motivo.
-- =====================================================================

-- --------------------------------------------------------------- Áreas
CREATE TABLE IF NOT EXISTS public.amenities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    icon VARCHAR(20) NOT NULL DEFAULT 'other'
        CHECK (icon IN ('pool', 'bbq', 'event', 'sports', 'gym', 'playground', 'games', 'cowork', 'other')),
    description VARCHAR(500),
    rules TEXT CHECK (char_length(rules) <= 4000),
    photo_file_id UUID,
    mode VARCHAR(10) NOT NULL DEFAULT 'exclusive' CHECK (mode IN ('exclusive', 'shared')),
    capacity SMALLINT NOT NULL DEFAULT 10 CHECK (capacity BETWEEN 1 AND 2000),
    open_time TIME NOT NULL DEFAULT '08:00',
    close_time TIME NOT NULL DEFAULT '22:00',
    weekdays SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
    slot_minutes SMALLINT NOT NULL DEFAULT 60 CHECK (slot_minutes IN (30, 60, 120)),
    max_duration_minutes SMALLINT NOT NULL DEFAULT 120 CHECK (max_duration_minutes BETWEEN 30 AND 1440),
    min_advance_hours SMALLINT NOT NULL DEFAULT 0 CHECK (min_advance_hours BETWEEN 0 AND 720),
    max_advance_days SMALLINT NOT NULL DEFAULT 30 CHECK (max_advance_days BETWEEN 1 AND 365),
    cancel_hours SMALLINT NOT NULL DEFAULT 24 CHECK (cancel_hours BETWEEN 0 AND 720),
    max_active_per_unit SMALLINT CHECK (max_active_per_unit IS NULL OR max_active_per_unit BETWEEN 1 AND 50),
    cost NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
    requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
    block_delinquent BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_amenities_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT uq_amenities_name UNIQUE (condominium_id, name),
    CONSTRAINT fk_amenities_photo FOREIGN KEY (condominium_id, photo_file_id)
        REFERENCES public.files(condominium_id, id) ON DELETE SET NULL (photo_file_id),
    CONSTRAINT ck_amenities_hours CHECK (close_time > open_time),
    CONSTRAINT ck_amenities_weekdays CHECK (weekdays <@ '{1,2,3,4,5,6,7}'::SMALLINT[] AND cardinality(weekdays) > 0),
    CONSTRAINT ck_amenities_duration CHECK (max_duration_minutes >= slot_minutes)
);

COMMENT ON TABLE public.amenities IS 'Áreas comunes reservables';
COMMENT ON COLUMN public.amenities.mode IS 'exclusive = un grupo a la vez; shared = varios hasta la capacidad (personas)';
COMMENT ON COLUMN public.amenities.weekdays IS 'Días abiertos, ISO: 1 = lunes … 7 = domingo';
COMMENT ON COLUMN public.amenities.min_advance_hours IS 'Horas mínimas entre la solicitud y el inicio';
COMMENT ON COLUMN public.amenities.max_advance_days IS 'Hasta cuántos días adelante se puede reservar';
COMMENT ON COLUMN public.amenities.cancel_hours IS 'Cancelando con al menos estas horas de anticipación se anula el cargo';
COMMENT ON COLUMN public.amenities.max_active_per_unit IS 'Reservas futuras simultáneas por filial (vacío = sin límite)';
COMMENT ON COLUMN public.amenities.block_delinquent IS 'Las filiales con deuda vencida no pueden reservar';

CREATE TRIGGER trg_amenities_updated_at BEFORE UPDATE ON public.amenities
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_amenities AFTER INSERT OR UPDATE OR DELETE ON public.amenities
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Feriados, cierres y restricciones
CREATE TABLE IF NOT EXISTS public.amenity_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    amenity_id UUID,
    unit_id UUID,
    kind VARCHAR(12) NOT NULL CHECK (kind IN ('holiday', 'unavailable', 'restriction')),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    reason VARCHAR(200) NOT NULL,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_amenity_blocks_amenity FOREIGN KEY (condominium_id, amenity_id)
        REFERENCES public.amenities(condominium_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_amenity_blocks_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_amenity_blocks_range CHECK (ends_at IS NULL OR ends_at > starts_at),
    CONSTRAINT ck_amenity_blocks_unit CHECK ((kind = 'restriction') = (unit_id IS NOT NULL))
);

COMMENT ON TABLE public.amenity_blocks IS 'Feriados y cierres (para todos) y restricciones (para una filial), de un área o de todas';
COMMENT ON COLUMN public.amenity_blocks.amenity_id IS 'Vacío = todas las áreas';
COMMENT ON COLUMN public.amenity_blocks.ends_at IS 'Vacío = hasta que la administración lo quite';

CREATE INDEX IF NOT EXISTS idx_amenity_blocks_range ON public.amenity_blocks (condominium_id, starts_at, ends_at);

CREATE TRIGGER trg_audit_amenity_blocks AFTER INSERT OR UPDATE OR DELETE ON public.amenity_blocks
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Reservaciones
CREATE TABLE IF NOT EXISTS public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    amenity_id UUID NOT NULL,
    unit_id UUID NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    guests SMALLINT NOT NULL DEFAULT 1 CHECK (guests BETWEEN 1 AND 2000),
    notes VARCHAR(500),
    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    cost NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
    charge_id UUID,
    booked_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_notes VARCHAR(500),
    cancelled_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    cancelled_at TIMESTAMPTZ,
    cancel_reason VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bookings_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_bookings_amenity FOREIGN KEY (condominium_id, amenity_id)
        REFERENCES public.amenities(condominium_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_bookings_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_bookings_charge FOREIGN KEY (condominium_id, charge_id)
        REFERENCES public.charges(condominium_id, id) ON DELETE SET NULL (charge_id),
    CONSTRAINT ck_bookings_range CHECK (ends_at > starts_at)
);

COMMENT ON TABLE public.bookings IS 'Reservaciones de áreas comunes por filial';
COMMENT ON COLUMN public.bookings.cost IS 'Costo del área al reservar (se carga a la filial al aprobarse)';
COMMENT ON COLUMN public.bookings.charge_id IS 'Cargo generado en el estado de cuenta (anulado si se cancela a tiempo)';

CREATE INDEX IF NOT EXISTS idx_bookings_amenity_time ON public.bookings (condominium_id, amenity_id, starts_at)
    WHERE status IN ('pending', 'approved');
CREATE INDEX IF NOT EXISTS idx_bookings_unit ON public.bookings (condominium_id, unit_id, starts_at DESC);

CREATE TRIGGER trg_bookings_updated_at BEFORE UPDATE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_bookings AFTER INSERT OR UPDATE OR DELETE ON public.bookings
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Archivos y avisos
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_purpose_check;
ALTER TABLE public.files ADD CONSTRAINT files_purpose_check
    CHECK (purpose IN ('condominium_logo', 'authorization_photo', 'payment_receipt', 'expense_receipt', 'amenity_photo'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('alert', 'alert_update', 'visit', 'visit_update', 'message', 'announcement', 'payment', 'charge', 'booking'));

-- --------------------------------------------------------------- RLS
ALTER TABLE public.amenities      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amenity_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings       ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_amenities_condominium ON public.amenities
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_amenity_blocks_condominium ON public.amenity_blocks
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_bookings_condominium ON public.bookings
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());

-- Historial: las reservas no se borran desde la app (se cancelan o rechazan)
REVOKE DELETE, TRUNCATE ON public.bookings FROM :"app_user";

-- --------------------------------------------------------------- Módulo y permisos
UPDATE public.catalogs_modules SET is_offline = FALSE WHERE code = 'BOOKINGS';

UPDATE public.catalogs_roles
   SET permissions = permissions
       || '{"BOOKINGS": ["access", "view", "add_new", "edit", "delete", "download", "approve", "configure"]}'::jsonb
 WHERE slug = 'admin';
