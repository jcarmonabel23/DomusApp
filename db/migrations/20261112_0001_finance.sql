-- =====================================================================
--  DomusApp · 20261112_0001_finance.sql  (Fase 5)
--  Cobros y finanzas:
--    · finance_settings         parámetros del condominio (interés moratorio, gracia, día de vencimiento)
--    · fee_plans (+ _units)     cuotas recurrentes: generan un cargo por filial cada mes
--    · charges                  cargos por filial: cuotas, extraordinarias, intereses, multas y especiales
--    · payments                 pagos en línea (pasarela) o manuales (comprobante + aprobación)
--    · payment_gateway_events   bitácora de webhooks de la pasarela
--    · bank_accounts            cuentas bancarias del condominio
--    · expenses                 gastos del condominio
--
--  Estado de cuenta = libro de la filial: cargos (debe) y pagos aprobados (haber) con saldo corrido.
--  Los pagos se aplican a la deuda más antigua primero (FIFO); la mora se calcula así, sin tabla de
--  aplicaciones. Cargos y pagos no se borran: los cargos se anulan con motivo y los pagos se rechazan.
-- =====================================================================

-- --------------------------------------------------------------- Parámetros
CREATE TABLE IF NOT EXISTS public.finance_settings (
    condominium_id UUID PRIMARY KEY DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    interest_rate NUMERIC(6, 3) NOT NULL DEFAULT 0 CHECK (interest_rate >= 0 AND interest_rate <= 10),
    grace_days SMALLINT NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 60),
    due_day SMALLINT NOT NULL DEFAULT 10 CHECK (due_day BETWEEN 1 AND 28),
    online_payments BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.finance_settings IS 'Parámetros de cobro del condominio';
COMMENT ON COLUMN public.finance_settings.interest_rate IS 'Interés moratorio mensual (%) sobre el capital vencido (no se cobran intereses sobre intereses)';
COMMENT ON COLUMN public.finance_settings.grace_days IS 'Días después del vencimiento antes de considerar la deuda en mora';
COMMENT ON COLUMN public.finance_settings.due_day IS 'Día del mes en que vencen las cuotas recurrentes';

CREATE TRIGGER trg_finance_settings_updated_at BEFORE UPDATE ON public.finance_settings
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_finance_settings AFTER INSERT OR UPDATE OR DELETE ON public.finance_settings
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Cuentas bancarias
CREATE TABLE IF NOT EXISTS public.bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    bank VARCHAR(80) NOT NULL,
    holder VARCHAR(120) NOT NULL,
    number VARCHAR(40) NOT NULL,
    iban VARCHAR(40),
    kind VARCHAR(10) NOT NULL DEFAULT 'checking' CHECK (kind IN ('checking', 'savings')),
    currency_code CHAR(3) NOT NULL REFERENCES public.catalogs_currencies(code),
    notes VARCHAR(300),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_bank_accounts_tenant_key UNIQUE (condominium_id, id)
);

COMMENT ON TABLE public.bank_accounts IS 'Cuentas del condominio: los residentes las ven para transferir o depositar';
COMMENT ON COLUMN public.bank_accounts.iban IS 'IBAN, CLABE, CBU o equivalente del país';

CREATE TRIGGER trg_bank_accounts_updated_at BEFORE UPDATE ON public.bank_accounts
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_bank_accounts AFTER INSERT OR UPDATE OR DELETE ON public.bank_accounts
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Cuotas recurrentes
CREATE TABLE IF NOT EXISTS public.fee_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    kind VARCHAR(14) NOT NULL DEFAULT 'ordinary' CHECK (kind IN ('ordinary', 'extraordinary')),
    mode VARCHAR(8) NOT NULL DEFAULT 'fixed' CHECK (mode IN ('fixed', 'aliquot', 'area')),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    scope VARCHAR(6) NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'units')),
    start_period DATE NOT NULL CHECK (EXTRACT(DAY FROM start_period) = 1),
    end_period DATE CHECK (end_period IS NULL OR EXTRACT(DAY FROM end_period) = 1),
    due_day SMALLINT CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 28),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_fee_plans_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT ck_fee_plans_range CHECK (end_period IS NULL OR end_period >= start_period)
);

COMMENT ON TABLE public.fee_plans IS 'Cuotas que se generan solas cada mes (mantenimiento, fondo de reserva, extraordinaria en N meses)';
COMMENT ON COLUMN public.fee_plans.mode IS 'fixed = monto igual por filial; aliquot = el monto es el total del mes y se reparte por alícuota; area = se reparte por m²';
COMMENT ON COLUMN public.fee_plans.scope IS 'all = todas las filiales activas; units = solo las de fee_plans_units';
COMMENT ON COLUMN public.fee_plans.end_period IS 'Último mes (inclusive); vacío = indefinida';

CREATE TRIGGER trg_fee_plans_updated_at BEFORE UPDATE ON public.fee_plans
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_fee_plans AFTER INSERT OR UPDATE OR DELETE ON public.fee_plans
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

CREATE TABLE IF NOT EXISTS public.fee_plans_units (
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL,
    unit_id UUID NOT NULL,
    PRIMARY KEY (plan_id, unit_id),
    CONSTRAINT fk_fee_plans_units_plan FOREIGN KEY (condominium_id, plan_id)
        REFERENCES public.fee_plans(condominium_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_fee_plans_units_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE CASCADE
);

-- --------------------------------------------------------------- Cargos
CREATE TABLE IF NOT EXISTS public.charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL,
    kind VARCHAR(14) NOT NULL CHECK (kind IN ('ordinary', 'extraordinary', 'interest', 'fine', 'special')),
    concept VARCHAR(160) NOT NULL,
    period DATE CHECK (period IS NULL OR EXTRACT(DAY FROM period) = 1),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    due_date DATE NOT NULL,
    plan_id UUID,
    notes VARCHAR(500),
    voided_at TIMESTAMPTZ,
    voided_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    void_reason VARCHAR(300),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_charges_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_charges_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_charges_plan FOREIGN KEY (condominium_id, plan_id)
        REFERENCES public.fee_plans(condominium_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_charges_void CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);

COMMENT ON TABLE public.charges IS 'Lo que debe cada filial. No se borra: se anula con motivo';
COMMENT ON COLUMN public.charges.kind IS 'ordinary = cuota, extraordinary = cuota extraordinaria, interest = interés moratorio, fine = multa, special = cargo especial';
COMMENT ON COLUMN public.charges.period IS 'Mes al que corresponde (primer día del mes); vacío en cargos sueltos';

-- Generación idempotente: una cuota por plan, filial y mes; un interés por filial y mes
CREATE UNIQUE INDEX IF NOT EXISTS uq_charges_plan_period ON public.charges (plan_id, unit_id, period)
    WHERE plan_id IS NOT NULL AND voided_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_charges_interest_period ON public.charges (unit_id, period)
    WHERE kind = 'interest' AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_charges_unit ON public.charges (condominium_id, unit_id, due_date) WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_charges_period ON public.charges (condominium_id, period);

CREATE TRIGGER trg_audit_charges AFTER INSERT OR UPDATE OR DELETE ON public.charges
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Pagos
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL,
    method VARCHAR(10) NOT NULL CHECK (method IN ('online', 'transfer', 'deposit', 'cash', 'other')),
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    paid_on DATE NOT NULL DEFAULT CURRENT_DATE,
    reference VARCHAR(60),
    bank_account_id UUID,
    receipt_file_id UUID,
    notes VARCHAR(500),
    status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    review_notes VARCHAR(500),
    reviewed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    gateway VARCHAR(20),
    gateway_ref VARCHAR(80),
    card_brand VARCHAR(20),
    card_last4 CHAR(4) CHECK (card_last4 IS NULL OR card_last4 ~ '^[0-9]{4}$'),
    submitted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payments_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_payments_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_payments_bank FOREIGN KEY (condominium_id, bank_account_id)
        REFERENCES public.bank_accounts(condominium_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_payments_receipt FOREIGN KEY (receipt_file_id) REFERENCES public.files(id) ON DELETE SET NULL,
    CONSTRAINT ck_payments_review CHECK (status = 'pending' OR reviewed_at IS NOT NULL),
    CONSTRAINT ck_payments_online CHECK (method <> 'online' OR (gateway IS NOT NULL AND gateway_ref IS NOT NULL))
);

COMMENT ON TABLE public.payments IS 'Pagos de las filiales: en línea (pasarela) o manuales con comprobante. Solo los aprobados bajan la deuda';
COMMENT ON COLUMN public.payments.status IS 'pending = en revisión o procesando; approved = aplicado; rejected = rechazado (no cuenta)';
COMMENT ON COLUMN public.payments.card_last4 IS 'Solo los últimos 4 dígitos: el número de tarjeta nunca se guarda';

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_gateway_ref ON public.payments (gateway, gateway_ref) WHERE gateway_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_unit ON public.payments (condominium_id, unit_id, paid_on) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_payments_pending ON public.payments (condominium_id, created_at) WHERE status = 'pending';

CREATE TRIGGER trg_audit_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

CREATE TABLE IF NOT EXISTS public.payment_gateway_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    payment_id UUID,
    gateway VARCHAR(20) NOT NULL,
    event_id VARCHAR(80) NOT NULL,
    event VARCHAR(40) NOT NULL,
    payload JSONB NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_gateway_events UNIQUE (gateway, event_id),
    CONSTRAINT fk_gateway_events_payment FOREIGN KEY (condominium_id, payment_id)
        REFERENCES public.payments(condominium_id, id) ON DELETE SET NULL (payment_id)
);

COMMENT ON TABLE public.payment_gateway_events IS 'Webhooks recibidos de la pasarela (firmados); el event_id único evita procesarlos dos veces';

-- --------------------------------------------------------------- Gastos
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    spent_on DATE NOT NULL,
    category VARCHAR(16) NOT NULL CHECK (category IN (
        'maintenance', 'security', 'cleaning', 'utilities', 'administration', 'insurance', 'repairs', 'gardening', 'other')),
    supplier VARCHAR(120),
    description VARCHAR(300) NOT NULL,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    bank_account_id UUID,
    receipt_file_id UUID,
    voided_at TIMESTAMPTZ,
    voided_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    void_reason VARCHAR(300),
    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_expenses_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_expenses_bank FOREIGN KEY (condominium_id, bank_account_id)
        REFERENCES public.bank_accounts(condominium_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_expenses_receipt FOREIGN KEY (receipt_file_id) REFERENCES public.files(id) ON DELETE SET NULL,
    CONSTRAINT ck_expenses_void CHECK ((voided_at IS NULL) = (void_reason IS NULL))
);

COMMENT ON TABLE public.expenses IS 'Gastos del condominio; se anulan con motivo, no se borran';

CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses (condominium_id, spent_on DESC);

CREATE TRIGGER trg_audit_expenses AFTER INSERT OR UPDATE OR DELETE ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Archivos y avisos
ALTER TABLE public.files DROP CONSTRAINT IF EXISTS files_purpose_check;
ALTER TABLE public.files ADD CONSTRAINT files_purpose_check
    CHECK (purpose IN ('condominium_logo', 'authorization_photo', 'payment_receipt', 'expense_receipt'));

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
    CHECK (kind IN ('alert', 'alert_update', 'visit', 'visit_update', 'message', 'announcement', 'payment', 'charge'));

-- --------------------------------------------------------------- RLS
ALTER TABLE public.finance_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_plans              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fee_plans_units        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charges                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_gateway_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses               ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_finance_settings_condominium ON public.finance_settings
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_bank_accounts_condominium ON public.bank_accounts
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_fee_plans_condominium ON public.fee_plans
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_fee_plans_units_condominium ON public.fee_plans_units
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_charges_condominium ON public.charges
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_payments_condominium ON public.payments
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_payment_gateway_events_condominium ON public.payment_gateway_events
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_expenses_condominium ON public.expenses
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());

-- Evidencia contable: cargos, pagos, gastos y webhooks no se borran desde la app
REVOKE DELETE, TRUNCATE ON public.charges, public.payments, public.expenses FROM :"app_user";
REVOKE UPDATE, DELETE, TRUNCATE ON public.payment_gateway_events FROM :"app_user";

-- --------------------------------------------------------------- Módulo y permisos
UPDATE public.catalogs_modules SET is_offline = FALSE WHERE code = 'FINANCE';

INSERT INTO public.catalogs_permissions (order_list, slug, name, description) VALUES
    (8, 'approve', 'Aprobar', 'Aprobar o rechazar solicitudes (pagos con comprobante…)')
ON CONFLICT (slug) DO NOTHING;

UPDATE public.catalogs_roles
   SET permissions = permissions
       || '{"FINANCE": ["access", "view", "add_new", "edit", "delete", "download", "approve", "configure"]}'::jsonb
 WHERE slug = 'admin';
