-- =====================================================================
--  DomusApp · 00010_catalogs_countries.sql
--  Monedas y países (Latinoamérica + EE. UU. y España). Cada condominio
--  elige su país, su moneda y su zona horaria; el país sugiere los valores
--  por defecto y las etiquetas de identificación.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.catalogs_currencies (
    code CHAR(3) PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
    name VARCHAR(60) NOT NULL,
    symbol VARCHAR(6) NOT NULL,
    decimals SMALLINT NOT NULL DEFAULT 2 CHECK (decimals BETWEEN 0 AND 4),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE public.catalogs_currencies IS 'Monedas disponibles para los condominios (ISO 4217)';
COMMENT ON COLUMN public.catalogs_currencies.code IS 'Código ISO 4217';
COMMENT ON COLUMN public.catalogs_currencies.symbol IS 'Símbolo para mostrar montos';
COMMENT ON COLUMN public.catalogs_currencies.decimals IS 'Decimales de la moneda (CLP y PYG no usan)';

INSERT INTO public.catalogs_currencies (code, name, symbol, decimals) VALUES
    ('ARS', 'Peso argentino',         '$',    2),
    ('BOB', 'Boliviano',              'Bs',   2),
    ('BRL', 'Real brasileño',         'R$',   2),
    ('CLP', 'Peso chileno',           '$',    0),
    ('COP', 'Peso colombiano',        '$',    2),
    ('CRC', 'Colón costarricense',    '₡',    2),
    ('DOP', 'Peso dominicano',        'RD$',  2),
    ('EUR', 'Euro',                   '€',    2),
    ('GTQ', 'Quetzal',                'Q',    2),
    ('HNL', 'Lempira',                'L',    2),
    ('MXN', 'Peso mexicano',          '$',    2),
    ('NIO', 'Córdoba',                'C$',   2),
    ('PAB', 'Balboa',                 'B/.',  2),
    ('PEN', 'Sol',                    'S/',   2),
    ('PYG', 'Guaraní',                '₲',    0),
    ('USD', 'Dólar estadounidense',   'US$',  2),
    ('UYU', 'Peso uruguayo',          '$',    2),
    ('VES', 'Bolívar',                'Bs.',  2)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.catalogs_countries (
    code CHAR(2) PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
    name VARCHAR(60) NOT NULL,
    currency_code CHAR(3) NOT NULL REFERENCES public.catalogs_currencies(code),
    timezone VARCHAR(60) NOT NULL,
    phone_code VARCHAR(6) NOT NULL,
    person_id_label VARCHAR(40) NOT NULL,
    tax_id_label VARCHAR(40) NOT NULL,
    order_list INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE public.catalogs_countries IS 'Países donde opera DomusApp, con su moneda, zona horaria y etiquetas de identificación';
COMMENT ON COLUMN public.catalogs_countries.code IS 'Código ISO 3166-1 alfa-2';
COMMENT ON COLUMN public.catalogs_countries.currency_code IS 'Moneda sugerida para un condominio nuevo';
COMMENT ON COLUMN public.catalogs_countries.timezone IS 'Zona horaria IANA sugerida';
COMMENT ON COLUMN public.catalogs_countries.phone_code IS 'Prefijo telefónico internacional';
COMMENT ON COLUMN public.catalogs_countries.person_id_label IS 'Cómo se llama el documento de identidad de una persona (Cédula, DNI, CURP…)';
COMMENT ON COLUMN public.catalogs_countries.tax_id_label IS 'Cómo se llama la identificación tributaria (RIF, NIT, RUC…)';

INSERT INTO public.catalogs_countries (order_list, code, name, currency_code, timezone, phone_code, person_id_label, tax_id_label) VALUES
    ( 1, 'AR', 'Argentina',            'ARS', 'America/Argentina/Buenos_Aires', '+54',  'DNI',                 'CUIT'),
    ( 2, 'BO', 'Bolivia',              'BOB', 'America/La_Paz',                 '+591', 'CI',                  'NIT'),
    ( 3, 'BR', 'Brasil',               'BRL', 'America/Sao_Paulo',              '+55',  'CPF',                 'CNPJ'),
    ( 4, 'CL', 'Chile',                'CLP', 'America/Santiago',               '+56',  'RUT',                 'RUT'),
    ( 5, 'CO', 'Colombia',             'COP', 'America/Bogota',                 '+57',  'Cédula de ciudadanía','NIT'),
    ( 6, 'CR', 'Costa Rica',           'CRC', 'America/Costa_Rica',             '+506', 'Cédula',              'Cédula jurídica'),
    ( 7, 'EC', 'Ecuador',              'USD', 'America/Guayaquil',              '+593', 'Cédula',              'RUC'),
    ( 8, 'SV', 'El Salvador',          'USD', 'America/El_Salvador',            '+503', 'DUI',                 'NIT'),
    ( 9, 'GT', 'Guatemala',            'GTQ', 'America/Guatemala',              '+502', 'DPI',                 'NIT'),
    (10, 'HN', 'Honduras',             'HNL', 'America/Tegucigalpa',            '+504', 'DNI',                 'RTN'),
    (11, 'MX', 'México',               'MXN', 'America/Mexico_City',            '+52',  'CURP',                'RFC'),
    (12, 'NI', 'Nicaragua',            'NIO', 'America/Managua',                '+505', 'Cédula',              'RUC'),
    (13, 'PA', 'Panamá',               'USD', 'America/Panama',                 '+507', 'Cédula',              'RUC'),
    (14, 'PY', 'Paraguay',             'PYG', 'America/Asuncion',               '+595', 'CI',                  'RUC'),
    (15, 'PE', 'Perú',                 'PEN', 'America/Lima',                   '+51',  'DNI',                 'RUC'),
    (16, 'DO', 'República Dominicana', 'DOP', 'America/Santo_Domingo',          '+1',   'Cédula',              'RNC'),
    (17, 'UY', 'Uruguay',              'UYU', 'America/Montevideo',             '+598', 'CI',                  'RUT'),
    (18, 'VE', 'Venezuela',            'VES', 'America/Caracas',                '+58',  'Cédula',              'RIF'),
    (19, 'US', 'Estados Unidos',       'USD', 'America/New_York',               '+1',   'ID',                  'EIN'),
    (20, 'ES', 'España',               'EUR', 'Europe/Madrid',                  '+34',  'DNI/NIE',             'NIF')
ON CONFLICT (code) DO NOTHING;
