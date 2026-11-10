-- =====================================================================
--  DomusApp · 20261114_0001_admin_management.sql  (Fase 7)
--  Gestión administrativa:
--    · cases / case_updates / case_files      daños, mejoras, quejas, sugerencias y denuncias con seguimiento
--    · suppliers (+ contactos, personal, contratos)
--    · assemblies / assembly_agreements      asambleas, actas y seguimiento de acuerdos
--    · documents                             reglamentos, circulares, manuales y formularios (PDF)
--    · inventory_items / inventory_logs      bienes del condominio con su bitácora
--
--  Archivos: además de imágenes, la API acepta PDF (variante única orig.pdf, se entrega como descarga).
--  Denuncias anónimas: se guarda quién la hizo (para que la vea en "Mis casos"), pero la API nunca
--  lo muestra a la administración ni la liga a la filial.
-- =====================================================================

-- --------------------------------------------------------------- Proveedores
CREATE TABLE IF NOT EXISTS public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    legal_id VARCHAR(30),
    category VARCHAR(20) NOT NULL DEFAULT 'other'
        CHECK (category IN ('security', 'cleaning', 'maintenance', 'gardening', 'elevators', 'pools', 'plumbing',
                            'electrical', 'pest_control', 'administration', 'other')),
    phone VARCHAR(30),
    email VARCHAR(120),
    address VARCHAR(200),
    website VARCHAR(200),
    notes VARCHAR(1000),
    show_to_residents BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_suppliers_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT uq_suppliers_name UNIQUE (condominium_id, name)
);

COMMENT ON TABLE public.suppliers IS 'Proveedores del condominio';
COMMENT ON COLUMN public.suppliers.show_to_residents IS 'Aparece en el directorio de proveedores de la app';

CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_suppliers AFTER INSERT OR UPDATE OR DELETE ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

CREATE TABLE IF NOT EXISTS public.supplier_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL,
    names VARCHAR(120) NOT NULL,
    role VARCHAR(80),
    phone VARCHAR(30),
    email VARCHAR(120),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_supplier_contacts_supplier FOREIGN KEY (condominium_id, supplier_id)
        REFERENCES public.suppliers(condominium_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_supplier_contacts ON public.supplier_contacts (condominium_id, supplier_id);
CREATE TRIGGER trg_audit_supplier_contacts AFTER INSERT OR UPDATE OR DELETE ON public.supplier_contacts
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- Personal designado por el proveedor (guardas, conserjes, jardineros…)
CREATE TABLE IF NOT EXISTS public.supplier_staff (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL,
    names VARCHAR(120) NOT NULL,
    id_number VARCHAR(30),
    role VARCHAR(80),
    phone VARCHAR(30),
    schedule VARCHAR(120),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_supplier_staff_supplier FOREIGN KEY (condominium_id, supplier_id)
        REFERENCES public.suppliers(condominium_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_supplier_staff ON public.supplier_staff (condominium_id, supplier_id);
CREATE TRIGGER trg_audit_supplier_staff AFTER INSERT OR UPDATE OR DELETE ON public.supplier_staff
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

CREATE TABLE IF NOT EXISTS public.supplier_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL,
    title VARCHAR(160) NOT NULL,
    starts_on DATE NOT NULL,
    ends_on DATE,
    amount NUMERIC(14, 2) CHECK (amount IS NULL OR amount >= 0),
    frequency VARCHAR(10) NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'quarterly', 'yearly', 'one_time')),
    notes VARCHAR(1000),
    file_id UUID,
    is_cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_supplier_contracts_supplier FOREIGN KEY (condominium_id, supplier_id)
        REFERENCES public.suppliers(condominium_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_supplier_contracts_file FOREIGN KEY (condominium_id, file_id)
        REFERENCES public.files(condominium_id, id) ON DELETE SET NULL (file_id),
    CONSTRAINT ck_supplier_contracts_range CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
COMMENT ON COLUMN public.supplier_contracts.ends_on IS 'Vacío = indefinido. Vence pronto si faltan 30 días o menos';
CREATE INDEX IF NOT EXISTS idx_supplier_contracts ON public.supplier_contracts (condominium_id, supplier_id);
CREATE TRIGGER trg_supplier_contracts_updated_at BEFORE UPDATE ON public.supplier_contracts
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_supplier_contracts AFTER INSERT OR UPDATE OR DELETE ON public.supplier_contracts
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Casos
CREATE TABLE IF NOT EXISTS public.cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    category VARCHAR(12) NOT NULL CHECK (category IN ('damage', 'improvement', 'complaint', 'suggestion', 'report')),
    title VARCHAR(120) NOT NULL,
    description TEXT NOT NULL CHECK (char_length(description) <= 4000),
    location VARCHAR(120),
    unit_id UUID,
    priority VARCHAR(8) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed', 'rejected')),
    is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
    source VARCHAR(6) NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'panel')),
    reported_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    supplier_id UUID,
    assignee VARCHAR(120),
    due_on DATE,
    resolved_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
    rating_comment VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cases_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT uq_cases_number UNIQUE (condominium_id, number),
    CONSTRAINT fk_cases_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE SET NULL (unit_id),
    CONSTRAINT fk_cases_supplier FOREIGN KEY (condominium_id, supplier_id)
        REFERENCES public.suppliers(condominium_id, id) ON DELETE SET NULL (supplier_id),
    CONSTRAINT ck_cases_anonymous CHECK (NOT is_anonymous OR (category = 'report' AND unit_id IS NULL))
);

COMMENT ON TABLE public.cases IS 'Casos: daños, mejoras, quejas, sugerencias y denuncias';
COMMENT ON COLUMN public.cases.number IS 'Correlativo por condominio (#0001)';
COMMENT ON COLUMN public.cases.is_anonymous IS 'Denuncia anónima: la API no muestra a la administración quién la hizo';
COMMENT ON COLUMN public.cases.assignee IS 'Responsable interno (texto libre) además del proveedor';
COMMENT ON COLUMN public.cases.rating IS 'Calificación de la atención (1-5) que da quien reportó al resolverse';

CREATE INDEX IF NOT EXISTS idx_cases_status ON public.cases (condominium_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_reporter ON public.cases (condominium_id, reported_by, created_at DESC);

CREATE TRIGGER trg_cases_updated_at BEFORE UPDATE ON public.cases
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_cases AFTER INSERT OR UPDATE OR DELETE ON public.cases
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- Seguimiento: comentarios, cambios de estado y notas internas (solo administración)
CREATE TABLE IF NOT EXISTS public.case_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    case_id UUID NOT NULL,
    author_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    side VARCHAR(8) NOT NULL CHECK (side IN ('resident', 'staff')),
    body VARCHAR(2000),
    status_from VARCHAR(12),
    status_to VARCHAR(12),
    is_internal BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_case_updates_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_case_updates_case FOREIGN KEY (condominium_id, case_id)
        REFERENCES public.cases(condominium_id, id) ON DELETE CASCADE,
    CONSTRAINT ck_case_updates_content CHECK (body IS NOT NULL OR status_to IS NOT NULL),
    CONSTRAINT ck_case_updates_internal CHECK (NOT is_internal OR side = 'staff')
);
CREATE INDEX IF NOT EXISTS idx_case_updates ON public.case_updates (condominium_id, case_id, created_at);
CREATE TRIGGER trg_audit_case_updates AFTER INSERT OR UPDATE OR DELETE ON public.case_updates
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

CREATE TABLE IF NOT EXISTS public.case_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    case_id UUID NOT NULL,
    update_id UUID,
    file_id UUID NOT NULL,
    side VARCHAR(8) NOT NULL CHECK (side IN ('resident', 'staff')),
    is_internal BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_case_files_case FOREIGN KEY (condominium_id, case_id)
        REFERENCES public.cases(condominium_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_case_files_update FOREIGN KEY (condominium_id, update_id)
        REFERENCES public.case_updates(condominium_id, id) ON DELETE SET NULL (update_id),
    CONSTRAINT fk_case_files_file FOREIGN KEY (condominium_id, file_id)
        REFERENCES public.files(condominium_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_case_files ON public.case_files (condominium_id, case_id);

-- --------------------------------------------------------------- Asambleas y acuerdos
CREATE TABLE IF NOT EXISTS public.assemblies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    title VARCHAR(160) NOT NULL,
    kind VARCHAR(14) NOT NULL DEFAULT 'ordinary' CHECK (kind IN ('ordinary', 'extraordinary')),
    scheduled_at TIMESTAMPTZ NOT NULL,
    location VARCHAR(200),
    meeting_url VARCHAR(300),
    agenda TEXT CHECK (char_length(agenda) <= 4000),
    status VARCHAR(10) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'held', 'cancelled')),
    attendance_units SMALLINT CHECK (attendance_units IS NULL OR attendance_units >= 0),
    quorum_reached BOOLEAN,
    summary TEXT CHECK (char_length(summary) <= 4000),
    minutes_file_id UUID,
    cancel_reason VARCHAR(300),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_assemblies_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_assemblies_minutes FOREIGN KEY (condominium_id, minutes_file_id)
        REFERENCES public.files(condominium_id, id) ON DELETE SET NULL (minutes_file_id)
);
COMMENT ON TABLE public.assemblies IS 'Asambleas de propietarios: convocatoria, agenda, acta y quórum';
COMMENT ON COLUMN public.assemblies.attendance_units IS 'Filiales presentes o representadas';
CREATE INDEX IF NOT EXISTS idx_assemblies_date ON public.assemblies (condominium_id, scheduled_at DESC);
CREATE TRIGGER trg_assemblies_updated_at BEFORE UPDATE ON public.assemblies
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_assemblies AFTER INSERT OR UPDATE OR DELETE ON public.assemblies
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

CREATE TABLE IF NOT EXISTS public.assembly_agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    assembly_id UUID NOT NULL,
    number SMALLINT NOT NULL CHECK (number > 0),
    title VARCHAR(200) NOT NULL,
    description TEXT CHECK (char_length(description) <= 2000),
    responsible VARCHAR(120),
    supplier_id UUID,
    due_on DATE,
    status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'done', 'cancelled')),
    progress_notes VARCHAR(1000),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_assembly_agreements_number UNIQUE (condominium_id, assembly_id, number),
    CONSTRAINT fk_assembly_agreements_assembly FOREIGN KEY (condominium_id, assembly_id)
        REFERENCES public.assemblies(condominium_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_assembly_agreements_supplier FOREIGN KEY (condominium_id, supplier_id)
        REFERENCES public.suppliers(condominium_id, id) ON DELETE SET NULL (supplier_id)
);
COMMENT ON TABLE public.assembly_agreements IS 'Acuerdos tomados en asamblea y su avance';
CREATE INDEX IF NOT EXISTS idx_assembly_agreements ON public.assembly_agreements (condominium_id, status, due_on);
CREATE TRIGGER trg_assembly_agreements_updated_at BEFORE UPDATE ON public.assembly_agreements
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_assembly_agreements AFTER INSERT OR UPDATE OR DELETE ON public.assembly_agreements
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Documentos
CREATE TABLE IF NOT EXISTS public.documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    title VARCHAR(160) NOT NULL,
    category VARCHAR(12) NOT NULL DEFAULT 'other'
        CHECK (category IN ('regulation', 'circular', 'minutes', 'manual', 'form', 'financial', 'other')),
    description VARCHAR(500),
    audience VARCHAR(10) NOT NULL DEFAULT 'residents' CHECK (audience IN ('residents', 'staff')),
    published_on DATE NOT NULL DEFAULT CURRENT_DATE,
    file_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_documents_file FOREIGN KEY (condominium_id, file_id)
        REFERENCES public.files(condominium_id, id) ON DELETE SET NULL (file_id)
);
COMMENT ON TABLE public.documents IS 'Reglamentos, circulares, manuales y formularios';
COMMENT ON COLUMN public.documents.audience IS 'residents = visible en la app; staff = solo panel';
COMMENT ON COLUMN public.documents.file_id IS 'PDF o imagen; sin archivo no aparece en la app';
CREATE INDEX IF NOT EXISTS idx_documents ON public.documents (condominium_id, is_active, published_on DESC);
CREATE TRIGGER trg_documents_updated_at BEFORE UPDATE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_documents AFTER INSERT OR UPDATE OR DELETE ON public.documents
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Inventario
CREATE TABLE IF NOT EXISTS public.inventory_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    code VARCHAR(30) NOT NULL,
    name VARCHAR(120) NOT NULL,
    category VARCHAR(12) NOT NULL DEFAULT 'other'
        CHECK (category IN ('furniture', 'equipment', 'appliance', 'electronics', 'tools', 'security', 'sports', 'garden', 'other')),
    location VARCHAR(120),
    amenity_id UUID,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    unit_value NUMERIC(14, 2) CHECK (unit_value IS NULL OR unit_value >= 0),
    acquired_on DATE,
    supplier_id UUID,
    brand VARCHAR(80),
    model VARCHAR(80),
    serial VARCHAR(80),
    condition VARCHAR(6) NOT NULL DEFAULT 'good' CHECK (condition IN ('good', 'fair', 'poor', 'broken')),
    photo_file_id UUID,
    maintenance_months SMALLINT CHECK (maintenance_months IS NULL OR maintenance_months BETWEEN 1 AND 120),
    next_maintenance_on DATE,
    notes VARCHAR(1000),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    retired_at TIMESTAMPTZ,
    retire_reason VARCHAR(300),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_inventory_items_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT uq_inventory_items_code UNIQUE (condominium_id, code),
    CONSTRAINT fk_inventory_items_amenity FOREIGN KEY (condominium_id, amenity_id)
        REFERENCES public.amenities(condominium_id, id) ON DELETE SET NULL (amenity_id),
    CONSTRAINT fk_inventory_items_supplier FOREIGN KEY (condominium_id, supplier_id)
        REFERENCES public.suppliers(condominium_id, id) ON DELETE SET NULL (supplier_id),
    CONSTRAINT fk_inventory_items_photo FOREIGN KEY (condominium_id, photo_file_id)
        REFERENCES public.files(condominium_id, id) ON DELETE SET NULL (photo_file_id)
);
COMMENT ON TABLE public.inventory_items IS 'Mobiliario, equipos y bienes del condominio';
COMMENT ON COLUMN public.inventory_items.maintenance_months IS 'Cada cuántos meses lleva mantenimiento (al registrar uno se recalcula el próximo)';
CREATE INDEX IF NOT EXISTS idx_inventory_items ON public.inventory_items (condominium_id, is_active, category);
CREATE TRIGGER trg_inventory_items_updated_at BEFORE UPDATE ON public.inventory_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_inventory_items AFTER INSERT OR UPDATE OR DELETE ON public.inventory_items
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

CREATE TABLE IF NOT EXISTS public.inventory_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    item_id UUID NOT NULL,
    kind VARCHAR(12) NOT NULL CHECK (kind IN ('maintenance', 'repair', 'move', 'condition', 'retire', 'note')),
    happened_on DATE NOT NULL DEFAULT CURRENT_DATE,
    description VARCHAR(500) NOT NULL,
    cost NUMERIC(14, 2) CHECK (cost IS NULL OR cost >= 0),
    supplier_id UUID,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_inventory_logs_item FOREIGN KEY (condominium_id, item_id)
        REFERENCES public.inventory_items(condominium_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_logs_supplier FOREIGN KEY (condominium_id, supplier_id)
        REFERENCES public.suppliers(condominium_id, id) ON DELETE SET NULL (supplier_id)
);
COMMENT ON TABLE public.inventory_logs IS 'Bitácora de un bien: mantenimientos, reparaciones, traslados, estado y bajas';
CREATE INDEX IF NOT EXISTS idx_inventory_logs ON public.inventory_logs (condominium_id, item_id, happened_on DESC);
CREATE TRIGGER trg_audit_inventory_logs AFTER INSERT OR UPDATE OR DELETE ON public.inventory_logs
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Archivos y avisos
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_purpose_check;
ALTER TABLE public.files ADD CONSTRAINT files_purpose_check
    CHECK (purpose IN ('condominium_logo', 'authorization_photo', 'payment_receipt', 'expense_receipt', 'amenity_photo',
                       'case_attachment', 'document', 'contract', 'assembly_minutes', 'inventory_photo'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('alert', 'alert_update', 'visit', 'visit_update', 'message', 'announcement', 'payment', 'charge', 'booking',
                    'case', 'assembly', 'document'));

-- --------------------------------------------------------------- RLS
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['suppliers', 'supplier_contacts', 'supplier_staff', 'supplier_contracts', 'cases', 'case_updates',
                             'case_files', 'assemblies', 'assembly_agreements', 'documents', 'inventory_items', 'inventory_logs']
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS p_%s_condominium ON public.%I', t, t);
        EXECUTE format('CREATE POLICY p_%s_condominium ON public.%I USING (condominium_id = public.fn_current_condominium())
                        WITH CHECK (condominium_id = public.fn_current_condominium())', t, t);
    END LOOP;
END $$;

-- Historial: casos y su seguimiento no se borran desde la app (se cierran o se rechazan)
REVOKE DELETE, TRUNCATE ON public.cases, public.case_updates FROM :"app_user";

-- --------------------------------------------------------------- Módulos y permisos
UPDATE public.catalogs_modules SET is_offline = FALSE WHERE code IN ('CASES', 'ASSEMBLIES', 'DOCUMENTS', 'SUPPLIERS', 'INVENTORY');

UPDATE public.catalogs_roles
   SET permissions = permissions || '{
         "CASES":      ["access", "view", "add_new", "edit", "download", "configure"],
         "ASSEMBLIES": ["access", "view", "add_new", "edit", "delete", "download"],
         "DOCUMENTS":  ["access", "view", "add_new", "edit", "delete", "download"],
         "SUPPLIERS":  ["access", "view", "add_new", "edit", "delete", "download"],
         "INVENTORY":  ["access", "view", "add_new", "edit", "delete", "download"]
       }'::jsonb
 WHERE slug = 'admin';
