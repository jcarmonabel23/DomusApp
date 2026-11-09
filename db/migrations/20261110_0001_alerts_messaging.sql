-- =====================================================================
--  DomusApp · 20261110_0001_alerts_messaging.sql  (Fase 3)
--  Botón de pánico, alertas y mensajería:
--    · alerts              alertas de pánico (activa → en camino → atendida)
--    · messages            hilo de cada filial con la caseta (guarda ↔ residentes)
--    · messages_reads      hasta dónde leyó cada cuenta cada hilo
--    · announcements       comunicados de la administración
--    · notifications       bandeja de la campana (por cuenta y condominio)
--    · push_tokens         dispositivos para notificaciones push (Expo)
--  Las tablas de condominio llevan RLS por condominium_id y FK compuestas.
-- =====================================================================

-- --------------------------------------------------------------- Alertas
CREATE TABLE IF NOT EXISTS public.alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    unit_id UUID,

    kind VARCHAR(20) NOT NULL CHECK (kind IN (
        'robbery', 'fire', 'flood', 'intruder', 'vandalism', 'short_circuit',
        'domestic_violence', 'medical', 'accident', 'other')),
    notes VARCHAR(500),
    status VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'attended')),

    raised_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    attended_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    attended_at TIMESTAMPTZ,
    resolution VARCHAR(1000),

    CONSTRAINT uq_alerts_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_alerts_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE RESTRICT,
    CONSTRAINT ck_alerts_ack CHECK (status = 'active' OR acknowledged_at IS NOT NULL),
    CONSTRAINT ck_alerts_attended CHECK (status <> 'attended' OR attended_at IS NOT NULL)
);

COMMENT ON TABLE public.alerts IS 'Botón de pánico: sigue activa (con sonido en la caseta) hasta que un guarda la marca atendida';
COMMENT ON COLUMN public.alerts.status IS 'active = nadie la ha tomado; acknowledged = un guarda va en camino; attended = cerrada con resolución';

CREATE INDEX IF NOT EXISTS idx_alerts_open ON public.alerts (condominium_id, raised_at DESC) WHERE status <> 'attended';
CREATE INDEX IF NOT EXISTS idx_alerts_time ON public.alerts (condominium_id, raised_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unit ON public.alerts (condominium_id, unit_id, raised_at DESC);

CREATE TRIGGER trg_audit_alerts AFTER INSERT OR UPDATE OR DELETE ON public.alerts
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Mensajería con la caseta
CREATE TABLE IF NOT EXISTS public.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL,

    side VARCHAR(10) NOT NULL CHECK (side IN ('guard', 'resident')),
    body VARCHAR(2000) NOT NULL CHECK (length(btrim(body)) > 0),
    sender_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_messages_tenant_key UNIQUE (condominium_id, id),
    CONSTRAINT fk_messages_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.messages IS 'Un hilo por filial entre la caseta (cualquier guarda o administrador) y las cuentas de esa filial';
COMMENT ON COLUMN public.messages.side IS 'Quién habla: guard = la caseta; resident = la filial';

CREATE INDEX IF NOT EXISTS idx_messages_thread ON public.messages (condominium_id, unit_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.messages_reads (
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    unit_id UUID NOT NULL,
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (condominium_id, user_id, unit_id),
    CONSTRAINT fk_messages_reads_unit FOREIGN KEY (condominium_id, unit_id)
        REFERENCES public.units(condominium_id, id) ON DELETE CASCADE
);

COMMENT ON TABLE public.messages_reads IS 'Hasta qué momento leyó cada cuenta el hilo de una filial (para los no leídos)';

-- --------------------------------------------------------------- Comunicados
CREATE TABLE IF NOT EXISTS public.announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,

    title VARCHAR(140) NOT NULL,
    body VARCHAR(5000) NOT NULL,
    audience VARCHAR(12) NOT NULL DEFAULT 'all' CHECK (audience IN ('all', 'residents', 'guards')),
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_announcements_tenant_key UNIQUE (condominium_id, id)
);

COMMENT ON TABLE public.announcements IS 'Comunicados de la administración para residentes, guardas o todos';

CREATE INDEX IF NOT EXISTS idx_announcements_time ON public.announcements (condominium_id, published_at DESC) WHERE is_active;

CREATE TRIGGER trg_announcements_updated_at BEFORE UPDATE ON public.announcements
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_announcements AFTER INSERT OR UPDATE OR DELETE ON public.announcements
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

-- --------------------------------------------------------------- Notificaciones (campana)
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condominium_id UUID NOT NULL DEFAULT public.fn_current_condominium()
        REFERENCES public.condominiums(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

    kind VARCHAR(20) NOT NULL CHECK (kind IN ('alert', 'alert_update', 'visit', 'visit_update', 'message', 'announcement')),
    title VARCHAR(140) NOT NULL,
    body VARCHAR(500),
    data JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(data) = 'object'),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.notifications IS 'Bandeja de la campana: una fila por cuenta destinataria';
COMMENT ON COLUMN public.notifications.data IS 'Referencia para abrir la pantalla: {alertId}, {unitId}, {announcementId}, {logId}';

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (condominium_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON public.notifications (condominium_id, user_id) WHERE read_at IS NULL;

-- --------------------------------------------------------------- Dispositivos push
-- Tabla de PLATAFORMA (un dispositivo es de la cuenta, no del condominio): sin RLS de condominio.
CREATE TABLE IF NOT EXISTS public.push_tokens (
    token VARCHAR(200) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    platform VARCHAR(10) NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    session_id UUID REFERENCES public.users_sessions(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    failures INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.push_tokens IS 'Tokens de Expo Push por dispositivo; se borran al cerrar sesión o si Expo los rechaza';
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON public.push_tokens (user_id);

-- --------------------------------------------------------------- RLS
ALTER TABLE public.alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications  ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_alerts_condominium ON public.alerts
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_messages_condominium ON public.messages
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_messages_reads_condominium ON public.messages_reads
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_announcements_condominium ON public.announcements
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());
CREATE POLICY p_notifications_condominium ON public.notifications
    USING (condominium_id = public.fn_current_condominium())
    WITH CHECK (condominium_id = public.fn_current_condominium());

-- Las alertas y los mensajes son evidencia: no se borran desde la app
REVOKE DELETE, TRUNCATE ON public.alerts FROM :"app_user";
REVOKE UPDATE, DELETE, TRUNCATE ON public.messages FROM :"app_user";

-- --------------------------------------------------------------- Módulos y permisos
UPDATE public.catalogs_modules SET is_offline = FALSE WHERE code = 'ALERTS';

INSERT INTO public.catalogs_modules (order_list, code, name, description, icon, path, scope, phase, is_public, is_offline) VALUES
    (6, 'MESSAGES', 'Comunicados', 'Comunicados de la administración para residentes y guardas', 'speakerphone', '/announcements', 'condominium', 3, FALSE, FALSE)
ON CONFLICT (code) DO NOTHING;

UPDATE public.catalogs_roles
   SET permissions = permissions
       || '{"ALERTS":   ["access", "view", "edit", "download"],
            "MESSAGES": ["access", "view", "add_new", "edit", "delete"]}'::jsonb
 WHERE slug = 'admin';
