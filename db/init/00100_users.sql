-- =====================================================================
--  DomusApp · 00100_users.sql
--  Usuarios: identidad, credenciales y estado de bloqueo. Un usuario es
--  global: su pertenencia a cada condominio vive en users_condominiums.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email CITEXT NOT NULL UNIQUE,
    names VARCHAR(120) NOT NULL,
    phone VARCHAR(30),
    password_hash VARCHAR(100) NOT NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    password_changed_at TIMESTAMPTZ,

    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,

    logins INTEGER NOT NULL DEFAULT 0,
    last_login_at TIMESTAMPTZ,

    metadata JSONB NOT NULL DEFAULT '{}',

    created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users IS 'Usuarios de DomusApp: identidad, credenciales y estado de bloqueo';
COMMENT ON COLUMN public.users.email IS 'Correo electrónico; identificador de login (sin distinción de mayúsculas)';
COMMENT ON COLUMN public.users.password_hash IS 'Hash bcrypt de la contraseña (nunca texto plano)';
COMMENT ON COLUMN public.users.is_active IS 'Cuenta activa. Inactiva = no inicia sesión y sus sesiones se rechazan';
COMMENT ON COLUMN public.users.is_platform_admin IS 'Administra la plataforma: crea condominios y tiene todos los permisos en todos';
COMMENT ON COLUMN public.users.must_change_password IS 'Debe cambiar la contraseña antes de usar el sistema (primer ingreso o reinicio)';
COMMENT ON COLUMN public.users.failed_attempts IS 'Intentos fallidos de contraseña consecutivos';
COMMENT ON COLUMN public.users.locked_until IS 'Cuenta bloqueada por fuerza bruta hasta esta fecha';

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_users AFTER INSERT OR UPDATE OR DELETE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

CREATE TABLE IF NOT EXISTS public.users_passwords_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    password_hash VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.users_passwords_history IS 'Hashes de contraseñas anteriores, para impedir reutilizar las últimas N';
CREATE INDEX IF NOT EXISTS idx_users_passwords_history_user ON public.users_passwords_history (user_id, created_at DESC);
