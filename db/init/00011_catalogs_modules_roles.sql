-- =====================================================================
--  DomusApp · 00011_catalogs_modules_roles.sql
--  Módulos del panel y roles dentro de un condominio.
--
--  · Un usuario pertenece a uno o varios condominios con UN rol en cada uno
--    (users_condominiums.role). El rol concede permisos POR MÓDULO:
--      catalogs_roles.permissions = {"UNITS": ["access","view",…], …}
--  · El administrador de plataforma (users.is_platform_admin) tiene todos
--    los permisos en todos los condominios, y es el único que ve los módulos
--    de alcance 'platform' (alta de condominios).
--  · Los módulos de fases futuras nacen con is_offline = TRUE: el panel los
--    muestra como "Próximamente" y la API los rechaza.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.catalogs_permissions (
    slug VARCHAR(40) PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    description VARCHAR(300),
    order_list INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.catalogs_permissions IS 'Acciones concedibles sobre un módulo; front y API consultan por slug';

INSERT INTO public.catalogs_permissions (order_list, slug, name, description) VALUES
    (1, 'access',    'Acceso',      'Entrar al módulo'),
    (2, 'view',      'Ver',         'Consultar registros'),
    (3, 'add_new',   'Agregar',     'Crear registros'),
    (4, 'edit',      'Editar',      'Modificar registros'),
    (5, 'delete',    'Eliminar',    'Dar de baja registros'),
    (6, 'download',  'Descargar',   'Exportar listados'),
    (7, 'configure', 'Configurar',  'Configuración sensible del módulo (invitar usuarios, restringir accesos…)')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.catalogs_modules (
    code VARCHAR(40) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]*$'),
    name VARCHAR(80) NOT NULL,
    description VARCHAR(300),
    icon VARCHAR(40),
    path VARCHAR(120) NOT NULL UNIQUE,
    scope VARCHAR(20) NOT NULL DEFAULT 'condominium' CHECK (scope IN ('platform', 'condominium')),
    phase SMALLINT NOT NULL DEFAULT 1,
    order_list INTEGER NOT NULL DEFAULT 0,
    is_public BOOLEAN NOT NULL DEFAULT FALSE,
    is_offline BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.catalogs_modules IS 'Módulos del panel administrativo';
COMMENT ON COLUMN public.catalogs_modules.code IS 'Código que usan front (useCan) y API (requirePermission)';
COMMENT ON COLUMN public.catalogs_modules.icon IS 'Clave del ícono (Tabler) que pinta el panel';
COMMENT ON COLUMN public.catalogs_modules.scope IS 'platform = solo administradores de plataforma; condominium = datos del condominio activo';
COMMENT ON COLUMN public.catalogs_modules.phase IS 'Fase del plan en que se construye';
COMMENT ON COLUMN public.catalogs_modules.is_public IS 'Accesible para cualquier usuario del panel sin permiso explícito (Tablero)';
COMMENT ON COLUMN public.catalogs_modules.is_offline IS 'Fuera de servicio o aún no construido: el panel lo muestra deshabilitado y la API responde 503';

CREATE TRIGGER trg_catalogs_modules_updated_at BEFORE UPDATE ON public.catalogs_modules
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_catalogs_modules AFTER INSERT OR UPDATE OR DELETE ON public.catalogs_modules
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

INSERT INTO public.catalogs_modules (order_list, code, name, description, icon, path, scope, phase, is_public, is_offline) VALUES
    ( 0, 'DASHBOARD',    'Tablero',                   'Resumen del condominio',                                                   'home',              '/dashboard',    'condominium', 0, TRUE,  FALSE),
    ( 1, 'CONDOMINIUMS', 'Condominios',               'Condominios, residenciales, centros comerciales y oficentros de la plataforma', 'building-community','/condominiums', 'platform',    1, FALSE, FALSE),
    ( 2, 'UNITS',        'Filiales',                  'Casas, apartamentos, locales y oficinas',                                 'home-cog',          '/units',        'condominium', 1, FALSE, FALSE),
    ( 3, 'PEOPLE',       'Personas',                  'Propietarios, inquilinos y residentes de cada filial',                    'users',             '/people',       'condominium', 1, FALSE, FALSE),
    ( 4, 'MEMBERS',      'Usuarios',                  'Quién entra al panel y a la app: administradores, guardas y residentes',  'user-shield',       '/members',      'condominium', 1, FALSE, FALSE),
    ( 5, 'ACCESS',       'Control de acceso',         'Autorizados, visitas, vehículos y bitácora de ingresos y salidas',         'car',               '/access',       'condominium', 2, FALSE, TRUE),
    ( 6, 'ALERTS',       'Pánico y alertas',          'Emergencias en tiempo real y tiempos de atención',                         'alarm',             '/alerts',       'condominium', 3, FALSE, TRUE),
    ( 7, 'FINANCE',      'Cobros y finanzas',         'Cuotas, intereses, multas, pagos y estados de cuenta',                    'cash',              '/finance',      'condominium', 5, FALSE, TRUE),
    ( 8, 'BOOKINGS',     'Reservaciones',             'Áreas comunes, reglamentos de uso, horarios y bloqueos',                   'calendar-event',    '/bookings',     'condominium', 6, FALSE, TRUE),
    ( 9, 'CASES',        'Casos e incidentes',        'Daños, quejas, sugerencias y denuncias con seguimiento',                   'clipboard-list',    '/cases',        'condominium', 7, FALSE, TRUE),
    (10, 'ASSEMBLIES',   'Asambleas y acuerdos',      'Actas, acuerdos y su seguimiento',                                         'gavel',             '/assemblies',   'condominium', 7, FALSE, TRUE),
    (11, 'DOCUMENTS',    'Reglamentos y documentos',  'Reglamentos, circulares y documentos',                                     'file-text',         '/documents',    'condominium', 7, FALSE, TRUE),
    (12, 'SUPPLIERS',    'Proveedores',               'Contratos, personal designado y contactos',                                'truck-delivery',    '/suppliers',    'condominium', 7, FALSE, TRUE),
    (13, 'INVENTORY',    'Inventarios',               'Mobiliario, equipos y bienes del condominio',                              'packages',          '/inventory',    'condominium', 7, FALSE, TRUE),
    (14, 'REPORTS',      'Reportes',                  'Indicadores, accesos, morosidad e incidentes',                             'chart-bar',         '/reports',      'condominium', 8, FALSE, TRUE),
    (15, 'SETTINGS',     'Configuración',             'Datos del condominio: país, moneda, zona horaria y contacto',              'settings',          '/settings',     'condominium', 1, FALSE, FALSE)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.catalogs_roles (
    slug VARCHAR(20) PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    description VARCHAR(300),
    panel_access BOOLEAN NOT NULL DEFAULT FALSE,
    permissions JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(permissions) = 'object'),
    order_list INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.catalogs_roles IS 'Roles de un usuario dentro de un condominio';
COMMENT ON COLUMN public.catalogs_roles.panel_access IS 'Puede entrar al panel administrativo (los demás roles usan solo la app móvil)';
COMMENT ON COLUMN public.catalogs_roles.permissions IS 'Permisos por módulo: {"MODULO": ["access","view",…]}';

CREATE TRIGGER trg_catalogs_roles_updated_at BEFORE UPDATE ON public.catalogs_roles
    FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();
CREATE TRIGGER trg_audit_catalogs_roles AFTER INSERT OR UPDATE OR DELETE ON public.catalogs_roles
    FOR EACH ROW EXECUTE FUNCTION public.fn_audit();

INSERT INTO public.catalogs_roles (order_list, slug, name, description, panel_access, permissions) VALUES
    (1, 'admin',  'Administrador', 'Administra el condominio desde el panel y la app', TRUE,
        '{"UNITS":    ["access","view","add_new","edit","delete","download"],
          "PEOPLE":   ["access","view","add_new","edit","delete","download","configure"],
          "MEMBERS":  ["access","view","add_new","edit","delete","configure"],
          "SETTINGS": ["access","view","edit","configure"]}'),
    (2, 'owner',  'Propietario',   'Dueño de una o varias filiales; usa la app móvil', FALSE, '{}'),
    (3, 'tenant', 'Inquilino',     'Alquila una filial; usa la app móvil con permisos que define el propietario y la administración', FALSE, '{}'),
    (4, 'guard',  'Guarda de seguridad', 'Controla accesos y atiende alertas desde la app móvil', FALSE, '{}')
ON CONFLICT (slug) DO NOTHING;
