-- =====================================================================
--  DomusApp · 00120_sessions_logs.sql
--  Sesiones (refresh rotativo), OTP, bitácora de autenticación y traza
--  de la API. Las bitácoras son inmutables para la app.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.users_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    client VARCHAR(10) NOT NULL DEFAULT 'web' CHECK (client IN ('web', 'mobile')),
    condominium_id UUID REFERENCES public.condominiums(id) ON DELETE SET NULL,

    refresh_hash CHAR(64) NOT NULL UNIQUE,
    prev_refresh_hash CHAR(64),
    rotations INTEGER NOT NULL DEFAULT 0,
    rotated_at TIMESTAMPTZ,

    ip_address VARCHAR(64),
    user_agent TEXT,

    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(40),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users_sessions IS 'Sesiones; el access JWT lleva el id (sid) y se valida contra esta tabla en cada petición';
COMMENT ON COLUMN public.users_sessions.client IS 'web = panel (cookie httpOnly, cierre por inactividad); mobile = app (refresh en almacenamiento seguro, larga duración)';
COMMENT ON COLUMN public.users_sessions.condominium_id IS 'Condominio activo de la sesión (la API lo fija en app.condominium_id)';
COMMENT ON COLUMN public.users_sessions.refresh_hash IS 'SHA-256 del refresh token vigente';
COMMENT ON COLUMN public.users_sessions.prev_refresh_hash IS 'SHA-256 del refresh anterior, para detectar reuso tras la rotación';
COMMENT ON COLUMN public.users_sessions.expires_at IS 'Vencimiento absoluto: la rotación no lo extiende';
COMMENT ON COLUMN public.users_sessions.revoke_reason IS 'logout, logout_all, admin, reuse, password_change, password_reset, idle';

CREATE INDEX IF NOT EXISTS idx_users_sessions_user ON public.users_sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_sessions_prev ON public.users_sessions (prev_refresh_hash);

CREATE TABLE IF NOT EXISTS public.users_otp (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    purpose VARCHAR(20) NOT NULL CHECK (purpose IN ('login', 'password_reset')),
    client VARCHAR(10) NOT NULL DEFAULT 'web' CHECK (client IN ('web', 'mobile')),

    code_hash CHAR(64) NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sends INTEGER NOT NULL DEFAULT 1,
    last_sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,

    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users_otp IS 'Desafíos OTP: segundo factor de login y verificación para reiniciar contraseña (solo el HMAC del código)';
COMMENT ON COLUMN public.users_otp.client IS 'Cliente que pidió el login: define el tipo de sesión que se abre';
CREATE INDEX IF NOT EXISTS idx_users_otp_user ON public.users_otp (user_id, purpose) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS public.users_auth_history (
    id BIGSERIAL PRIMARY KEY,

    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    email CITEXT,

    event_type VARCHAR(40) NOT NULL,
    success BOOLEAN NOT NULL,
    detail JSONB NOT NULL DEFAULT '{}',

    trace_id UUID,
    ip_address VARCHAR(64),
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users_auth_history IS 'Eventos de autenticación (login, OTP, refresh, logout, bloqueos, contraseñas, cambio de condominio)';
CREATE INDEX IF NOT EXISTS idx_users_auth_history_user ON public.users_auth_history (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_auth_history_created ON public.users_auth_history (created_at DESC);

CREATE TABLE IF NOT EXISTS public.trace_api_logs (
    id BIGSERIAL PRIMARY KEY,

    trace_id UUID NOT NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    condominium_id UUID,

    method VARCHAR(10) NOT NULL,
    path VARCHAR(300) NOT NULL,
    status INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    error_code VARCHAR(60),

    ip_address VARCHAR(64),
    user_agent TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.trace_api_logs IS 'Traza de peticiones a la API (escrituras y errores), correlacionable por trace_id';
CREATE INDEX IF NOT EXISTS idx_trace_api_logs_trace ON public.trace_api_logs (trace_id);
CREATE INDEX IF NOT EXISTS idx_trace_api_logs_created ON public.trace_api_logs (created_at DESC);
