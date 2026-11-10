/**
 * @project DomusApp - API
 * @file src/bootstrap.ts
 * @description Arranque: administrador de plataforma y (solo dev/qa) condominios de demostración
 *
 * @overview
 * - Si no existe ADMIN_EMAIL, se crea con ADMIN_INITIAL_PASSWORD, cambio obligatorio y la marca
 *   de administrador de plataforma. En cada arranque se asegura esa marca, para que la
 *   plataforma nunca quede sin quien la administre.
 * - Con SEED_DEMO=true (nunca en prod) y si aún no existe el condominio DEMO, crea:
 *     · Residencial Las Palmas (Costa Rica, CRC): 2 torres, 20 filiales, propietarios e inquilinos.
 *     · Oficentro Plaza Norte (Panamá, USD): 6 oficinas, para probar el cambio de condominio.
 *   Usuarios de prueba (contraseña DEMO_PASSWORD, sin cambio obligatorio):
 *     admin.demo@domusapp.local (administra ambos) · guarda@domusapp.local
 *     propietario@domusapp.local · inquilino@domusapp.local
 */

import type pg from "pg";
import { config } from "./config.js";
import { one, withTx } from "./db.js";
import { chargeBooking } from "./modules/bookings/shared.js";
import { seedDemoAdmin } from "./demoAdmin.js";
import { seedDemoHistory } from "./demoHistory.js";
import { logger } from "./lib/logger.js";
import { hashPassword } from "./lib/passwords.js";
import { applyInterest, generateMonth } from "./modules/finance/generate.js";

async function ensurePlatformAdmin(): Promise<void> {
  await withTx({}, async (client) => {
    const admin = await one<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [config.ADMIN_EMAIL], client);
    if (!admin) {
      await client.query(
        `INSERT INTO users (email, names, password_hash, must_change_password, is_platform_admin)
         VALUES ($1, 'Administrador de plataforma', $2, TRUE, TRUE)`,
        [config.ADMIN_EMAIL, await hashPassword(config.ADMIN_INITIAL_PASSWORD)]
      );
      logger.info({ email: config.ADMIN_EMAIL }, "[bootstrap] administrador de plataforma creado (debe cambiar la contraseña)");
    } else {
      await client.query(`UPDATE users SET is_platform_admin = TRUE WHERE id = $1 AND NOT is_platform_admin`, [admin.id]);
    }
  });
}

// ------------------------------------------------------------------ Demo

interface DemoPerson {
  names: string;
  idNumber: string;
  email?: string;
  phone: string;
  links: { unit: string; relation: "owner" | "tenant" | "resident"; primary?: boolean }[];
}

async function demoUser(client: pg.PoolClient, email: string, names: string, hash: string): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO users (email, names, password_hash, must_change_password, password_changed_at)
     VALUES ($1, $2, $3, FALSE, NOW())
     ON CONFLICT (email) DO UPDATE SET names = EXCLUDED.names RETURNING id`,
    [email, names, hash],
    client
  );
  return row!.id;
}

async function member(client: pg.PoolClient, userId: string, condominiumId: string, role: string, isDefault: boolean) {
  await client.query(
    `INSERT INTO users_condominiums (user_id, condominium_id, role, is_default) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, condominium_id) DO NOTHING`,
    [userId, condominiumId, role, isDefault]
  );
}

async function seedDemo(): Promise<void> {
  if (await one(`SELECT 1 FROM condominiums WHERE code = 'DEMO'`)) return;
  const hash = await hashPassword(config.DEMO_PASSWORD);

  const ids = await withTx({}, async (client) => {
    const palmas = await one<{ id: string }>(
      `INSERT INTO condominiums (code, kind, name, legal_name, tax_id, country_code, currency_code, timezone, address, city, state, phone, email, brand_color)
       VALUES ('DEMO', 'residential', 'Residencial Las Palmas', 'Condominio Residencial Las Palmas', '3-109-123456', 'CR', 'CRC',
               'America/Costa_Rica', 'Del parque central 300 m norte', 'Escazú', 'San José', '+506 2222-3333', 'admin@laspalmas.demo', '#1572d3')
       RETURNING id`,
      [],
      client
    );
    const plaza = await one<{ id: string }>(
      `INSERT INTO condominiums (code, kind, name, legal_name, tax_id, country_code, currency_code, timezone, address, city, state, phone, email, brand_color)
       VALUES ('DEMO-OFI', 'office', 'Oficentro Plaza Norte', 'Plaza Norte, S.A.', '155-704-2-2026', 'PA', 'USD',
               'America/Panama', 'Vía España, Edificio Plaza Norte', 'Ciudad de Panamá', 'Panamá', '+507 300-4000', 'info@plazanorte.demo', '#0f766e')
       RETURNING id`,
      [],
      client
    );
    const admin = await demoUser(client, "admin.demo@domusapp.local", "Andrea Solís (administradora)", hash);
    const guard = await demoUser(client, "guarda@domusapp.local", "Carlos Mora (guarda)", hash);
    const owner = await demoUser(client, "propietario@domusapp.local", "Henderson Rojas", hash);
    const tenant = await demoUser(client, "inquilino@domusapp.local", "Wilmer Carrasco", hash);
    await member(client, admin, palmas!.id, "admin", true);
    await member(client, admin, plaza!.id, "admin", false);
    await member(client, guard, palmas!.id, "guard", true);
    await member(client, owner, palmas!.id, "owner", true);
    await member(client, tenant, palmas!.id, "tenant", true);
    return { palmas: palmas!.id, plaza: plaza!.id, owner, tenant };
  });

  // Filiales y personas: tablas con RLS, se escriben dentro de cada condominio
  await withTx({ condominiumId: ids.palmas }, async (client) => {
    const codes: { code: string; tower: string; floor: string }[] = [];
    for (const tower of ["A", "B"]) {
      for (let floor = 1; floor <= 5; floor++) {
        for (let n = 1; n <= 2; n++) codes.push({ code: `${tower}-${floor}0${n}`, tower: `Torre ${tower}`, floor: String(floor) });
      }
    }
    for (const u of codes) {
      await client.query(
        `INSERT INTO units (code, tower, floor, kind, area_m2, aliquot) VALUES ($1, $2, $3, 'apartment', $4, 5)`,
        [u.code, u.tower, u.floor, u.floor === "5" ? 120 : 95]
      );
    }
    const people: DemoPerson[] = [
      { names: "Henderson Rojas", idNumber: "1-1111-1111", email: "propietario@domusapp.local", phone: "+506 8888-0001", links: [{ unit: "A-101", relation: "owner", primary: true }, { unit: "B-302", relation: "owner", primary: false }] },
      { names: "María Fernández", idNumber: "1-2222-2222", email: "maria.fernandez@demo.local", phone: "+506 8888-0002", links: [{ unit: "B-302", relation: "resident" }] },
      { names: "Wilmer Carrasco", idNumber: "8-0333-0333", email: "inquilino@domusapp.local", phone: "+506 8888-0003", links: [{ unit: "B-302", relation: "tenant", primary: true }] },
      { names: "Lucía Jiménez", idNumber: "2-0444-0444", phone: "+506 8888-0004", links: [{ unit: "A-102", relation: "owner", primary: true }] },
      { names: "Andrés Castillo", idNumber: "3-0555-0555", phone: "+506 8888-0005", links: [{ unit: "A-201", relation: "owner", primary: true }] },
      { names: "Sofía Vargas", idNumber: "1-0666-0666", phone: "+506 8888-0006", links: [{ unit: "A-202", relation: "owner", primary: true }] },
      { names: "Diego Salazar", idNumber: "1-0777-0777", phone: "+506 8888-0007", links: [{ unit: "B-101", relation: "owner", primary: true }] },
      { names: "Valeria Quesada", idNumber: "4-0888-0888", phone: "+506 8888-0008", links: [{ unit: "B-102", relation: "owner", primary: true }] }
    ];
    for (const p of people) {
      const userId = p.email === "propietario@domusapp.local" ? ids.owner : p.email === "inquilino@domusapp.local" ? ids.tenant : null;
      const person = await one<{ id: string }>(
        `INSERT INTO people (names, id_number, email, phone, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [p.names, p.idNumber, p.email ?? null, p.phone, userId],
        client
      );
      for (const l of p.links) {
        await client.query(
          `INSERT INTO units_people (unit_id, person_id, relation, is_primary)
           SELECT id, $2, $3, $4 FROM units WHERE code = $1`,
          [l.unit, person!.id, l.relation, l.primary ?? false]
        );
      }
    }
    await client.query(`UPDATE units SET occupancy = 'rented' WHERE code = 'B-302'`);
    await client.query(`UPDATE units SET occupancy = 'vacant' WHERE code IN ('A-502', 'B-502')`);
  });

  await withTx({ condominiumId: ids.plaza }, async (client) => {
    for (let n = 1; n <= 6; n++) {
      await client.query(`INSERT INTO units (code, tower, floor, kind, area_m2, aliquot) VALUES ($1, 'Edificio Norte', $2, 'office', 60, 16.666667)`, [
        `OF-${n}0${n % 2 === 0 ? 2 : 1}`,
        String(n)
      ]);
    }
  });

  logger.info("[bootstrap] condominios de demostración creados (DEMO y DEMO-OFI)");
}

/**
 * Datos de demostración del control de acceso (fase 2): vehículos, autorizados y algo de bitácora.
 * Corre aparte de seedDemo para que también llegue a una BD creada en la fase 1.
 */
/** Fase 3: un comunicado, dos alertas ya atendidas y una conversación con la caseta (idempotente) */
async function seedDemoAlerts(): Promise<void> {
  const palmas = await one<{ id: string }>(`SELECT id FROM condominiums WHERE code = 'DEMO'`);
  if (!palmas) return;
  const users = await one<{ owner: string; guard: string; admin: string }>(
    `SELECT (SELECT id FROM users WHERE email = 'propietario@domusapp.local') AS owner,
            (SELECT id FROM users WHERE email = 'guarda@domusapp.local') AS guard,
            (SELECT id FROM users WHERE email = 'admin.demo@domusapp.local') AS admin`
  );
  if (!users?.owner || !users.guard || !users.admin) return;

  await withTx({ condominiumId: palmas.id }, async (client) => {
    // Marca de "ya sembrado": cualquier comunicado del condominio demo
    if (await one(`SELECT 1 FROM announcements LIMIT 1`, [], client)) return;
    const unit = async (code: string) => (await one<{ id: string }>(`SELECT id FROM units WHERE code = $1`, [code], client))!.id;
    const a101 = await unit("A-101");
    const b302 = await unit("B-302");

    await client.query(
      `INSERT INTO announcements (title, body, audience, is_pinned, published_at, created_by, updated_by) VALUES
         ('Corte de agua programado', 'El jueves de 8:00 a 12:00 se dará mantenimiento al tanque principal. Les pedimos almacenar agua con anticipación.', 'all', TRUE, NOW() - INTERVAL '1 day', $1, $1),
         ('Nuevo horario de la piscina', 'A partir del lunes la piscina abre de 7:00 a 21:00. Los martes permanece cerrada por limpieza.', 'residents', FALSE, NOW() - INTERVAL '3 days', $1, $1)`,
      [users.admin]
    );

    await client.query(
      `INSERT INTO alerts (unit_id, kind, notes, status, raised_by, raised_at, acknowledged_by, acknowledged_at, attended_by, attended_at, resolution) VALUES
         ($1, 'intruder', 'Ruido en el patio trasero', 'attended', $3, NOW() - INTERVAL '4 days', $4, NOW() - INTERVAL '4 days' + INTERVAL '45 seconds',
          $4, NOW() - INTERVAL '4 days' + INTERVAL '9 minutes', 'Ronda en el patio: era un gato sobre el techo. Sin novedad.'),
         ($2, 'medical', 'Adulto mayor con mareo', 'attended', $3, NOW() - INTERVAL '2 days', $4, NOW() - INTERVAL '2 days' + INTERVAL '30 seconds',
          $4, NOW() - INTERVAL '2 days' + INTERVAL '25 minutes', 'Se llamó al 911; la ambulancia llegó en 18 minutos. Se acompañó hasta el portón.')`,
      [a101, b302, users.owner, users.guard]
    );

    await client.query(
      `INSERT INTO messages (unit_id, side, body, sender_id, created_at) VALUES
         ($1, 'resident', 'Buenas, espero un paquete de Amazon hoy. ¿Me lo pueden recibir?', $2, NOW() - INTERVAL '5 hours'),
         ($1, 'guard', 'Con gusto, lo dejamos en la caseta y le avisamos cuando llegue.', $3, NOW() - INTERVAL '4 hours 55 minutes')`,
      [a101, users.owner, users.guard]
    );
  });
}

/**
 * Fase 5: cuota de mantenimiento de ₡85 000 desde hace 3 meses, cuentas bancarias, pagos y gastos.
 * Casi todas las filiales están al día con los meses anteriores; B-302 debe dos meses (con interés) y tiene una
 * transferencia en revisión; A-202 debe el mes pasado; A-102 tiene una multa.
 */
async function seedDemoFinance(): Promise<void> {
  const palmas = await one<{ id: string }>(`SELECT id FROM condominiums WHERE code = 'DEMO'`);
  if (!palmas) return;
  const users = await one<{ tenant: string; admin: string }>(
    `SELECT (SELECT id FROM users WHERE email = 'inquilino@domusapp.local') AS tenant,
            (SELECT id FROM users WHERE email = 'admin.demo@domusapp.local') AS admin`
  );
  if (!users?.tenant || !users.admin) return;

  await withTx({ condominiumId: palmas.id, userId: users.admin }, async (client) => {
    // Marca de "ya sembrado": los parámetros de finanzas del condominio demo
    if (await one(`SELECT 1 FROM finance_settings LIMIT 1`, [], client)) return;
    await client.query(`INSERT INTO finance_settings (interest_rate, grace_days, due_day, online_payments) VALUES (2, 5, 10, TRUE)`);
    const bank = await one<{ id: string }>(
      `INSERT INTO bank_accounts (bank, holder, number, iban, kind, currency_code, notes) VALUES
         ('Banco de Costa Rica', 'Condominio Residencial Las Palmas', '001-0123456-7', 'CR05015201001012345678', 'checking', 'CRC',
          'Indique la filial en el detalle de la transferencia'),
         ('BAC Credomatic', 'Condominio Residencial Las Palmas', '912345678', 'CR21010200009123456789', 'savings', 'CRC', NULL)
       RETURNING id`,
      [],
      client
    );
    const p = await one<{ m0: string; m1: string; m2: string; m3: string }>(
      `SELECT to_char(date_trunc('month', CURRENT_DATE), 'YYYY-MM-DD') AS m0,
              to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '1 month', 'YYYY-MM-DD') AS m1,
              to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '2 months', 'YYYY-MM-DD') AS m2,
              to_char(date_trunc('month', CURRENT_DATE) - INTERVAL '3 months', 'YYYY-MM-DD') AS m3`,
      [],
      client
    );
    await client.query(
      `INSERT INTO fee_plans (name, kind, mode, amount, scope, start_period) VALUES ('Cuota de mantenimiento', 'ordinary', 'fixed', 85000, 'all', $1)`,
      [p!.m3]
    );
    for (const period of [p!.m3, p!.m2, p!.m1, p!.m0]) await generateMonth(client, palmas.id, period);

    // Pagos de los meses anteriores (día 5 de cada mes): B-302 solo pagó el primero; A-202 no pagó el último
    for (const [i, period] of [p!.m3, p!.m2, p!.m1].entries()) {
      await client.query(
        `INSERT INTO payments (unit_id, method, amount, paid_on, reference, bank_account_id, status, reviewed_at, reviewed_by)
         SELECT u.id, 'transfer', 85000, $1::date + 4, 'TRF-' || replace(u.code, '-', '') || '-' || $2::int, $3, 'approved', NOW(), fn_current_app_user()
           FROM units u
          WHERE u.is_active AND NOT (u.code = 'B-302' AND $2::int > 0) AND NOT (u.code = 'A-202' AND $2::int = 2)`,
        [period, i, bank!.id]
      );
    }
    await applyInterest(client, palmas.id, p!.m1);
    await applyInterest(client, palmas.id, p!.m0);

    await client.query(
      `INSERT INTO charges (unit_id, kind, concept, amount, due_date, notes)
       SELECT id, 'fine', 'Multa: música alta después de las 22:00', 25000, CURRENT_DATE + 10, 'Reglamento interno, art. 14'
         FROM units WHERE code = 'A-102'`
    );
    await client.query(
      `INSERT INTO payments (unit_id, method, amount, paid_on, reference, bank_account_id, notes, submitted_by)
       SELECT id, 'transfer', 85000, CURRENT_DATE - 1, 'TRF-88231', $1, 'Pago de la cuota atrasada', $2 FROM units WHERE code = 'B-302'`,
      [bank!.id, users.tenant]
    );
    await client.query(
      `INSERT INTO expenses (spent_on, category, supplier, description, amount, bank_account_id) VALUES
         (CURRENT_DATE - 20, 'security', 'Seguridad Alfa S.A.', 'Servicio de vigilancia 24/7 del mes', 1450000, $1),
         (CURRENT_DATE - 12, 'gardening', 'Jardines del Valle', 'Mantenimiento de zonas verdes', 180000, $1),
         (CURRENT_DATE - 6, 'utilities', 'AyA', 'Agua de áreas comunes', 96500, $1),
         (CURRENT_DATE - 3, 'repairs', 'Ferretería El Pino', 'Cambio de luminarias del parqueo', 74300, $1)`,
      [bank!.id]
    );
  });
}

async function seedDemoAccess(): Promise<void> {
  const palmas = await one<{ id: string }>(`SELECT id FROM condominiums WHERE code = 'DEMO'`);
  if (!palmas) return;
  const users = await one<{ owner: string; tenant: string; guard: string }>(
    `SELECT (SELECT id FROM users WHERE email = 'propietario@domusapp.local') AS owner,
            (SELECT id FROM users WHERE email = 'inquilino@domusapp.local') AS tenant,
            (SELECT id FROM users WHERE email = 'guarda@domusapp.local') AS guard`
  );
  if (!users?.owner || !users.guard) return;

  await withTx({ condominiumId: palmas.id }, async (client) => {
    // Marca de "ya sembrado": cualquier vehículo del condominio demo
    if (await one(`SELECT 1 FROM vehicles LIMIT 1`, [], client)) return;
    const unit = async (code: string) => (await one<{ id: string }>(`SELECT id FROM units WHERE code = $1`, [code], client))!.id;
    const a101 = await unit("A-101");
    const b302 = await unit("B-302");
    const a102 = await unit("A-102");

    await client.query(
      `INSERT INTO vehicles (unit_id, plate, kind, brand, model, color, created_by) VALUES
         ($1, 'BRT456', 'car', 'Toyota', 'RAV4', 'Gris', $3),
         ($1, 'MOT120', 'motorcycle', 'Honda', 'CB190', 'Rojo', $3),
         ($2, 'CRC789', 'car', 'Hyundai', 'Tucson', 'Blanco', $4)`,
      [a101, b302, users.owner, users.tenant]
    );

    await client.query(
      `INSERT INTO authorizations (unit_id, kind, names, id_number, plate, occupation, valid_from, valid_to, weekdays,
                                   time_from, time_to, call_to_confirm, delete_after_use, instructions, created_by) VALUES
         ($1, 'permanent', 'Rosa Rojas Mora', '1-0987-0654', NULL, NULL, NULL, NULL, NULL, NULL, NULL, FALSE, FALSE,
          'Es la mamá del propietario; puede pasar a cualquier hora', $3),
         ($1, 'employee', 'Carmen Solano Vega', '6-0234-0567', NULL, 'Niñera', NULL, NULL, '{1,2,3,4,5}', '07:00', '18:00', FALSE, FALSE,
          'Entra a pie por el portón peatonal', $3),
         ($1, 'temporary', 'Carlos Salgado Ordóñez', '1-1357-2468', 'BKL321', NULL, CURRENT_DATE, CURRENT_DATE + 2, NULL, NULL, NULL,
          TRUE, FALSE, 'Viene a instalar el internet', $3),
         ($2, 'temporary', 'Andrea Molina', '2-0246-0802', NULL, NULL, CURRENT_DATE, CURRENT_DATE, NULL, NULL, NULL, FALSE, TRUE,
          'Cumpleaños: viene con dos niños', $4)`,
      [a101, b302, users.owner, users.tenant]
    );

    // Bitácora de los últimos días para que el panel no arranque vacío
    await client.query(
      `INSERT INTO access_logs (unit_id, kind, names, id_number, plate, status, entry_at, exit_at, entry_by, exit_by, created_by, created_at) VALUES
         ($1, 'temporary', 'Wilmer Carrasco', '8-0333-0333', NULL, 'exited', NOW() - INTERVAL '2 days 3 hours', NOW() - INTERVAL '2 days 2 hours 30 minutes', $4, $4, $4, NOW() - INTERVAL '2 days 3 hours'),
         ($1, 'delivery', 'Mensajero Rappi', NULL, 'MTR555', 'exited', NOW() - INTERVAL '1 day 5 hours', NOW() - INTERVAL '1 day 4 hours 50 minutes', $4, $4, $4, NOW() - INTERVAL '1 day 5 hours'),
         ($2, 'resident', 'Residente B-302', NULL, 'CRC789', 'exited', NOW() - INTERVAL '1 day 2 hours', NOW() - INTERVAL '20 hours', $4, $4, $4, NOW() - INTERVAL '1 day 2 hours'),
         ($3, 'service', 'Técnico de agua', '5-0111-0222', 'TEC900', 'exited', NOW() - INTERVAL '6 hours', NOW() - INTERVAL '5 hours', $4, $4, $4, NOW() - INTERVAL '6 hours')`,
      [a101, b302, a102, users.guard]
    );
  });
  logger.info("[bootstrap] datos de demostración de control de acceso creados");
}

async function seedDemoBookings(): Promise<void> {
  const palmas = await one<{ id: string }>(`SELECT id FROM condominiums WHERE code = 'DEMO'`);
  if (!palmas) return;
  const users = await one<{ owner: string; tenant: string; admin: string }>(
    `SELECT (SELECT id FROM users WHERE email = 'propietario@domusapp.local') AS owner,
            (SELECT id FROM users WHERE email = 'inquilino@domusapp.local') AS tenant,
            (SELECT id FROM users WHERE email = 'admin.demo@domusapp.local') AS admin`
  );
  if (!users?.owner || !users.tenant || !users.admin) return;

  await withTx({ condominiumId: palmas.id, userId: users.admin }, async (client) => {
    // Marca de "ya sembrado": cualquier área común del condominio demo
    if (await one(`SELECT 1 FROM amenities LIMIT 1`, [], client)) return;
    const unit = async (code: string) => (await one<{ id: string }>(`SELECT id FROM units WHERE code = $1`, [code], client))!.id;
    const [a101, a102, b302] = [await unit("A-101"), await unit("A-102"), await unit("B-302")];

    const rows = await client.query<{ id: string; name: string }>(
      `INSERT INTO amenities (name, icon, description, rules, mode, capacity, open_time, close_time, slot_minutes, max_duration_minutes,
                              min_advance_hours, max_advance_days, cancel_hours, max_active_per_unit, cost, requires_approval, block_delinquent) VALUES
         ('Piscina', 'pool', 'Piscina semiolímpica con área de niños y duchas.',
          E'1. Ducharse antes de entrar.
2. Niños menores de 12 años con un adulto.
3. No se permiten envases de vidrio.
4. Máximo 6 invitados por filial.',
          'shared', 25, '07:00', '21:00', 60, 120, 0, 7, 2, 2, 0, FALSE, FALSE),
         ('Rancho BBQ', 'bbq', 'Rancho techado con parrilla de gas, fregadero y mesas para 20 personas.',
          E'1. Dejar la parrilla y el área limpias.
2. Música a volumen moderado; después de las 21:00, apagada.
3. La basura se lleva al depósito.
4. Cancelando con 48 h se anula el cargo.',
          'exclusive', 20, '10:00', '22:00', 60, 240, 24, 30, 48, 2, 10000, FALSE, TRUE),
         ('Salón de eventos', 'event', 'Salón climatizado con cocina, sonido y capacidad para 60 personas.',
          E'1. La administración aprueba cada reserva.
2. Hora máxima de salida: 23:00.
3. Daños al mobiliario se cargan a la filial.
4. Cancelando con 72 h se anula el cargo.',
          'exclusive', 60, '09:00', '23:00', 60, 360, 72, 90, 72, 1, 35000, TRUE, TRUE),
         ('Cancha multiuso', 'sports', 'Cancha de fútbol 5 y baloncesto con iluminación.',
          E'1. Calzado deportivo.
2. Apagar las luces al salir.',
          'exclusive', 12, '06:00', '22:00', 60, 120, 0, 7, 2, 2, 0, FALSE, FALSE),
         ('Gimnasio', 'gym', 'Máquinas de cardio y pesas.',
          E'1. Toalla obligatoria.
2. Regresar las pesas a su lugar.
3. Mayores de 16 años.',
          'shared', 8, '05:00', '22:00', 60, 60, 0, 3, 1, 1, 0, FALSE, FALSE)
       RETURNING id, name`
    );
    const area = Object.fromEntries(rows.rows.map((r) => [r.name, r.id]));

    // Feriado de Navidad (el próximo 25 de diciembre), limpieza de la piscina y una restricción a B-302
    const xmas = (await one<{ d: string }>(
      `SELECT to_char(CASE WHEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 12, 25) >= CURRENT_DATE
                           THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, 12, 25)
                           ELSE make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, 12, 25) END, 'YYYY-MM-DD') AS d`,
      [],
      client
    ))!.d;
    await client.query(
      `INSERT INTO amenity_blocks (amenity_id, unit_id, kind, starts_at, ends_at, reason) VALUES
         (NULL, NULL, 'holiday', $4::date::timestamptz, ($4::date + 1)::timestamptz, 'Navidad'),
         ($1, NULL, 'unavailable', (CURRENT_DATE + 3 + TIME '06:00')::timestamptz, (CURRENT_DATE + 3 + TIME '14:00')::timestamptz, 'Limpieza y cloración'),
         ($2, $3, 'restriction', CURRENT_DATE::timestamptz, (CURRENT_DATE + 30)::timestamptz, 'Daños en el último evento (pendiente de reparación)')`,
      [area["Piscina"], area["Salón de eventos"], b302, xmas]
    );

    const book = async (amenity: string, unitId: string, day: number, from: string, hours: number, guests: number, status: string, by: string, extra: { notes?: string; cancel?: string; cost?: number } = {}) => {
      const r = await one<{ id: string }>(
        `INSERT INTO bookings (amenity_id, unit_id, starts_at, ends_at, guests, notes, status, cost, booked_by, reviewed_by, reviewed_at,
                               cancelled_by, cancelled_at, cancel_reason)
         VALUES ($1, $2, (CURRENT_DATE + $3::int + $4::time)::timestamptz, (CURRENT_DATE + $3::int + $4::time)::timestamptz + make_interval(hours => $5::int),
                 $6, $7, $8::varchar, $9, $10, CASE WHEN $8::varchar = 'approved' THEN fn_current_app_user() END, CASE WHEN $8::varchar = 'approved' THEN NOW() END,
                 CASE WHEN $8::varchar = 'cancelled' THEN $10::uuid END, CASE WHEN $8::varchar = 'cancelled' THEN NOW() END, $11)
         RETURNING id`,
        [area[amenity], unitId, day, from, hours, guests, extra.notes ?? null, status, extra.cost ?? 0, by, extra.cancel ?? null],
        client
      );
      return r!.id;
    };
    const bbq = await book("Rancho BBQ", a101, 5, "12:00", 4, 15, "approved", users.owner, { notes: "Cumpleaños de Sofía", cost: 10000 });
    await chargeBooking(client, bbq);
    await book("Piscina", a101, 1, "15:00", 2, 4, "approved", users.owner);
    await book("Cancha multiuso", b302, 2, "18:00", 1, 10, "approved", users.tenant, { notes: "Mejenga de los martes" });
    await book("Salón de eventos", a102, 12, "18:00", 5, 50, "pending", users.owner, { notes: "Fiesta de 15 años", cost: 35000 });
    await book("Rancho BBQ", b302, 8, "14:00", 3, 8, "cancelled", users.tenant, { cancel: "Cambio de planes" });
    await book("Rancho BBQ", a101, -6, "14:00", 4, 12, "approved", users.owner, { notes: "Almuerzo familiar" });
  });
  logger.info("[bootstrap] datos de demostración de reservaciones creados");
}

export async function bootstrap(): Promise<void> {
  await ensurePlatformAdmin();
  if (config.SEED_DEMO && config.APP_ENVIRONMENT !== "prod") {
    await seedDemo();
    await seedDemoAccess();
    await seedDemoAlerts();
    await seedDemoFinance();
    await seedDemoBookings();
    await seedDemoAdmin();
    await seedDemoHistory();
  }
}
