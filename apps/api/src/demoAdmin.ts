/**
 * @project DomusApp - API
 * @file src/demoAdmin.ts
 * @description Datos de demostración de la Fase 7 (solo dev/qa, condominio DEMO): proveedores con contratos y
 *              personal, casos en varios estados, asambleas con acuerdos y acta, documentos e inventario.
 *              Los PDF de muestra se generan con pdfkit.
 */

import PDFDocument from "pdfkit";
import type pg from "pg";
import { one, withTx } from "./db.js";
import { logger } from "./lib/logger.js";
import { insertFileRow, storeUpload, type FilePurpose } from "./modules/files/images.js";

/** PDF de una página con título y párrafos */
function demoPdf(title: string, condo: string, paragraphs: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 64, info: { Title: title, Author: condo } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fillColor("#1572d3").fontSize(10).text(condo.toUpperCase(), { characterSpacing: 1 });
    doc.moveDown(0.5).fillColor("#1f2328").fontSize(20).text(title);
    doc.moveDown(1).fontSize(11).fillColor("#333");
    for (const p of paragraphs) doc.text(p, { align: "justify" }).moveDown(0.7);
    doc.moveDown(2).fontSize(8).fillColor("#888").text("Documento de demostración generado por DomusApp.");
    doc.end();
  });
}

async function storePdf(client: pg.PoolClient, condominiumId: string, purpose: FilePurpose, name: string, title: string, condo: string, paragraphs: string[]) {
  const buf = await demoPdf(title, condo, paragraphs);
  const stored = await storeUpload(buf, condominiumId, "receipt", true);
  await insertFileRow(client, stored, { purpose, originalName: `${name}.pdf`, originalMime: "application/pdf", originalBytes: buf.length });
  return stored.id;
}

export async function seedDemoAdmin(): Promise<void> {
  const palmas = await one<{ id: string; name: string }>(`SELECT id, name FROM condominiums WHERE code = 'DEMO'`);
  if (!palmas) return;
  const users = await one<{ owner: string; tenant: string; admin: string }>(
    `SELECT (SELECT id FROM users WHERE email = 'propietario@domusapp.local') AS owner,
            (SELECT id FROM users WHERE email = 'inquilino@domusapp.local') AS tenant,
            (SELECT id FROM users WHERE email = 'admin.demo@domusapp.local') AS admin`
  );
  if (!users?.owner || !users.tenant || !users.admin) return;
  const condo = palmas.name;

  const seeded = await withTx({ condominiumId: palmas.id, userId: users.admin }, async (client) => {
    // Marca de "ya sembrado": cualquier proveedor del condominio demo
    if (await one(`SELECT 1 FROM suppliers LIMIT 1`, [], client)) return false;
    const id = async (sql: string, params: unknown[] = []) => (await one<{ id: string }>(sql, params, client))!.id;
    const unit = (code: string) => id(`SELECT id FROM units WHERE code = $1`, [code]);
    const amenity = (name: string) => id(`SELECT id FROM amenities WHERE name = $1`, [name]);
    const [a101, b302] = [await unit("A-101"), await unit("B-302")];

    // ---------------------------------------------------------------- Proveedores
    const supplier = (name: string, legal: string, category: string, phone: string, email: string, show: boolean, daysAgo: number) =>
      id(
        `INSERT INTO suppliers (name, legal_id, category, phone, email, show_to_residents, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, fn_current_app_user(), now() - make_interval(days => $7)) RETURNING id`,
        [name, legal, category, phone, email, show, daysAgo]
      );
    const alfa = await supplier("Seguridad Integral Alfa S.A.", "3-101-456789", "security", "2222-1100", "operaciones@alfa.example", false, 400);
    const brillo = await supplier("Limpiezas Brillo", "3-101-552233", "cleaning", "2290-4545", "contacto@brillo.example", false, 300);
    const jardines = await supplier("Jardines del Valle", "3-102-778811", "gardening", "8855-1200", "info@jardinesvalle.example", true, 60);
    const ascensores = await supplier("Ascensores Andinos", "3-101-998877", "elevators", "2233-9090", "servicio@andinos.example", false, 700);
    const fontaneria = await supplier("Fontanería Rápida 24/7", "1-1234-5678", "plumbing", "8800-2424", "citas@fontaneria.example", true, 10);
    const electricos = await supplier("Electricistas Unidos", "3-101-334455", "electrical", "8711-3030", "hola@electricistas.example", true, 12);

    await client.query(
      `INSERT INTO supplier_contacts (supplier_id, names, role, phone, email, is_primary) VALUES
         ($1, 'Mauricio Solano', 'Supervisor de zona', '8890-1122', 'msolano@alfa.example', TRUE),
         ($1, 'Lucía Arce', 'Facturación', '2222-1101', 'facturas@alfa.example', FALSE),
         ($2, 'Patricia Mora', 'Coordinadora', '8701-4455', 'pmora@brillo.example', TRUE),
         ($3, 'Esteban Quirós', 'Jardinero jefe', '8855-1201', NULL, TRUE),
         ($4, 'Ing. Rolando Vega', 'Técnico asignado', '8333-7788', 'rvega@andinos.example', TRUE),
         ($5, 'Andrés Picado', 'Fontanero', '8800-2425', NULL, TRUE),
         ($6, 'Karla Núñez', 'Electricista certificada', '8711-3031', NULL, TRUE)`,
      [alfa, brillo, jardines, ascensores, fontaneria, electricos]
    );
    await client.query(
      `INSERT INTO supplier_staff (supplier_id, names, id_number, role, phone, schedule, is_active) VALUES
         ($1, 'Carlos Jiménez Rojas', '1-0987-0654', 'Oficial de seguridad', '8600-1111', 'L a V, 06:00–18:00', TRUE),
         ($1, 'José Pablo Vargas', '2-0765-0432', 'Oficial de seguridad', '8600-2222', 'L a V, 18:00–06:00', TRUE),
         ($1, 'María Fernanda Ulate', '1-1543-0876', 'Oficial de seguridad', '8600-3333', 'Fines de semana', TRUE),
         ($1, 'Roberto Calvo', '3-0456-0789', 'Oficial de seguridad', NULL, NULL, FALSE),
         ($2, 'Ana Lucía Brenes', '1-1122-0333', 'Conserje', '8611-4444', 'L a S, 07:00–15:00', TRUE),
         ($2, 'Yorleny Castro', '5-0333-0222', 'Conserje', '8611-5555', 'L a S, 13:00–21:00', TRUE),
         ($3, 'Esteban Quirós', '1-0876-0123', 'Jardinero', '8855-1201', 'Martes y viernes', TRUE)`,
      [alfa, brillo, jardines]
    );
    const contract = (sid: string, title: string, from: number, to: number | null, amount: number, freq: string) =>
      client.query(
        `INSERT INTO supplier_contracts (supplier_id, title, starts_on, ends_on, amount, frequency, created_by)
         VALUES ($1, $2, CURRENT_DATE + $3::int, CURRENT_DATE + $4::int, $5, $6, fn_current_app_user())`,
        [sid, title, from, to, amount, freq]
      );
    await contract(alfa, "Servicio de seguridad 24/7 (3 puestos)", -345, 20, 2400000, "monthly");
    await contract(brillo, "Limpieza de áreas comunes", -120, 245, 850000, "monthly");
    await contract(jardines, "Mantenimiento de jardines", -45, 320, 280000, "monthly");
    await contract(ascensores, "Mantenimiento preventivo de ascensores", -380, -15, 1500000, "yearly");

    // ---------------------------------------------------------------- Casos
    type Upd = [side: "resident" | "staff", author: string, hoursAfter: number, body: string | null, from?: string, to?: string, internal?: boolean];
    let number = 0;
    const kase = async (c: {
      category: string;
      title: string;
      description: string;
      location?: string;
      unitId: string | null;
      by: string;
      source?: string;
      priority?: string;
      status: string;
      anonymous?: boolean;
      supplierId?: string;
      assignee?: string;
      dueIn?: number;
      daysAgo: number;
      rating?: number;
      ratingComment?: string;
      updates?: Upd[];
    }) => {
      number += 1;
      const caseId = await id(
        `INSERT INTO cases (number, category, title, description, location, unit_id, priority, status, is_anonymous, source, reported_by,
                            supplier_id, assignee, due_on, rating, rating_comment, created_at,
                            resolved_at, closed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::varchar, $9, $10, $11, $12, $13, CURRENT_DATE + $14::int, $15, $16, now() - make_interval(days => $17),
                 CASE WHEN $8::varchar IN ('resolved', 'closed') THEN now() - make_interval(days => GREATEST($17 - 2, 0)) END,
                 CASE WHEN $8::varchar IN ('closed', 'rejected') THEN now() - make_interval(days => GREATEST($17 - 3, 0)) END)
         RETURNING id`,
        [
          number,
          c.category,
          c.title,
          c.description,
          c.location ?? null,
          c.unitId,
          c.priority ?? "normal",
          c.status,
          c.anonymous ?? false,
          c.source ?? "app",
          c.by,
          c.supplierId ?? null,
          c.assignee ?? null,
          c.dueIn ?? null,
          c.rating ?? null,
          c.ratingComment ?? null,
          c.daysAgo
        ]
      );
      for (const [side, author, hours, body, from, to, internal] of c.updates ?? []) {
        await client.query(
          `INSERT INTO case_updates (case_id, author_id, side, body, status_from, status_to, is_internal, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now() - make_interval(days => $8) + make_interval(hours => $9))`,
          [caseId, author, side, body, from ?? null, to ?? null, internal ?? false, c.daysAgo, hours]
        );
      }
    };
    await kase({
      category: "damage",
      title: "Fuga de agua en el pasillo de la torre A",
      description: "Desde anoche sale agua del cielo raso frente al ascensor del primer piso. El piso está mojado y alguien se puede resbalar.",
      location: "Torre A, piso 1, frente al ascensor",
      unitId: a101,
      by: users.owner,
      priority: "high",
      status: "in_progress",
      supplierId: fontaneria,
      assignee: "Conserjería",
      dueIn: 2,
      daysAgo: 2,
      updates: [
        ["staff", users.admin, 1, "Gracias por avisar. Colocamos rótulos de piso mojado y llamamos al fontanero.", "open", "in_progress"],
        ["staff", users.admin, 2, "Proveedor confirma visita mañana 8:00. Posible tubo de desagüe del A-201.", undefined, undefined, true],
        ["resident", users.owner, 20, "Sigue goteando un poco, pero ya no tanto."]
      ]
    });
    await kase({
      category: "suggestion",
      title: "Instalar un bicicletero en el parqueo",
      description: "Varios vecinos usamos bicicleta y no hay dónde dejarlas seguras. Propongo un bicicletero techado junto a la caseta.",
      location: "Parqueo de visitas",
      unitId: a101,
      by: users.owner,
      priority: "low",
      status: "open",
      daysAgo: 5
    });
    await kase({
      category: "complaint",
      title: "Ruido después de las 22:00",
      description: "Los fines de semana hay música alta hasta la 1:00 en la torre B. Ya hablamos con los vecinos sin resultado.",
      location: "Torre B, piso 3",
      unitId: b302,
      by: users.tenant,
      status: "resolved",
      assignee: "Administración",
      daysAgo: 9,
      updates: [
        ["staff", users.admin, 3, "Recibido. Enviaremos un recordatorio del reglamento de convivencia.", "open", "in_progress"],
        ["staff", users.admin, 120, "Se notificó por escrito a la filial y el último fin de semana no hubo quejas de la caseta. ¿Nos confirma si se resolvió?", "in_progress", "resolved"]
      ]
    });
    await kase({
      category: "damage",
      title: "Luminaria dañada en la entrada principal",
      description: "La lámpara del portón peatonal no enciende; de noche la entrada queda a oscuras.",
      location: "Portón peatonal",
      unitId: a101,
      by: users.owner,
      status: "closed",
      supplierId: electricos,
      daysAgo: 20,
      rating: 5,
      ratingComment: "Muy rápido, gracias.",
      updates: [
        ["staff", users.admin, 2, "Coordinamos con el electricista para mañana.", "open", "in_progress"],
        ["staff", users.admin, 30, "Se cambió el balastro y la lámpara. Ya enciende.", "in_progress", "resolved"],
        ["resident", users.owner, 50, "Muy rápido, gracias.", "resolved", "closed"]
      ]
    });
    await kase({
      category: "report",
      title: "Mascotas sin correa en las áreas comunes",
      description: "En las mañanas hay perros sueltos cerca del área de juegos de niños. El reglamento pide correa en todo momento.",
      location: "Área de juegos",
      unitId: null,
      by: users.owner,
      status: "open",
      anonymous: true,
      daysAgo: 1
    });
    await kase({
      category: "improvement",
      title: "Revisión de la iluminación del parqueo",
      description: "Recorrido nocturno de la administración: tres postes del parqueo de residentes tienen luz muy débil.",
      location: "Parqueo de residentes",
      unitId: null,
      by: users.admin,
      source: "panel",
      status: "open",
      supplierId: electricos,
      assignee: "Administración",
      dueIn: -1,
      daysAgo: 12
    });

    // ---------------------------------------------------------------- Asambleas y acuerdos
    const minutes = await storePdf(client, palmas.id, "assembly_minutes", "Acta asamblea ordinaria 2026", "Acta de asamblea ordinaria 2026", condo, [
      "En la sede del condominio, al ser las diecinueve horas, se reúne la asamblea ordinaria de propietarios con la presencia de 14 filiales, con lo que se alcanza el quórum requerido.",
      "Primero: se aprueba el informe de labores y el estado financiero del período.",
      "Segundo: se aprueba el presupuesto con un ajuste del 5 % en la cuota de mantenimiento.",
      "Tercero: se acuerda pintar la fachada de la torre B y cotizar cámaras para el parqueo.",
      "Cuarto: se acuerda cambiar el proveedor de jardinería."
    ]);
    const held = await id(
      `INSERT INTO assemblies (title, kind, scheduled_at, location, agenda, status, attendance_units, quorum_reached, summary, minutes_file_id, created_by)
       VALUES ('Asamblea ordinaria anual 2026', 'ordinary', (CURRENT_DATE - 60 + TIME '19:00')::timestamptz, 'Salón de eventos',
               E'1. Comprobación del quórum\n2. Informe de la administración\n3. Estados financieros\n4. Presupuesto 2027\n5. Asuntos varios',
               'held', 14, TRUE,
               'Se aprobaron el informe, los estados financieros y el presupuesto con ajuste del 5 %. Se acordó pintar la torre B, cotizar cámaras para el parqueo y cambiar el proveedor de jardinería.',
               $1, fn_current_app_user()) RETURNING id`,
      [minutes]
    );
    await client.query(
      `INSERT INTO assembly_agreements (assembly_id, number, title, description, responsible, supplier_id, due_on, status, progress_notes, completed_at) VALUES
         ($1, 1, 'Ajustar la cuota de mantenimiento en 5 %', 'Rige desde el mes siguiente a la asamblea.', 'Administración', NULL, CURRENT_DATE - 30, 'done', 'Aplicado en el plan de cuotas.', now() - interval '30 days'),
         ($1, 2, 'Pintar la fachada de la torre B', 'Tres cotizaciones; color aprobado: arena.', 'Junta directiva', NULL, CURRENT_DATE + 60, 'in_progress', 'Dos cotizaciones recibidas; falta una.', NULL),
         ($1, 3, 'Cotizar cámaras para el parqueo', 'Cobertura de las dos entradas y el parqueo de visitas.', 'Administración', $2, CURRENT_DATE - 5, 'pending', NULL, NULL),
         ($1, 4, 'Cambiar el proveedor de jardinería', NULL, 'Administración', $3, CURRENT_DATE - 40, 'done', 'Contrato firmado con Jardines del Valle.', now() - interval '45 days')`,
      [held, alfa, jardines]
    );
    await client.query(
      `INSERT INTO assemblies (title, kind, scheduled_at, location, meeting_url, agenda, created_by)
       VALUES ('Remodelación de la piscina', 'extraordinary', (CURRENT_DATE + 14 + TIME '19:00')::timestamptz, 'Salón de eventos',
               'https://meet.example.com/las-palmas',
               E'1. Comprobación del quórum\n2. Propuestas de remodelación (3 cotizaciones)\n3. Cuota extraordinaria\n4. Votación',
               fn_current_app_user())`
    );

    // ---------------------------------------------------------------- Documentos
    const doc = async (title: string, category: string, description: string, audience: string, daysAgo: number, paragraphs: string[]) => {
      const fileId = await storePdf(client, palmas.id, "document", title, title, condo, paragraphs);
      await client.query(
        `INSERT INTO documents (title, category, description, audience, published_on, file_id, created_by)
         VALUES ($1, $2, $3, $4, CURRENT_DATE - $5::int, $6, fn_current_app_user())`,
        [title, category, description, audience, daysAgo, fileId]
      );
    };
    await doc("Reglamento de condominio", "regulation", "Derechos y deberes de propietarios e inquilinos, convivencia y sanciones.", "residents", 400, [
      "Artículo 1. Este reglamento rige la convivencia en el condominio y obliga a propietarios, inquilinos, visitantes y personal.",
      "Artículo 2. Horario de silencio: de 22:00 a 7:00. Las mascotas circulan con correa en todas las áreas comunes.",
      "Artículo 3. Las cuotas de mantenimiento vencen el día 10 de cada mes; el atraso genera intereses según el plan vigente."
    ]);
    await doc("Reglamento de uso de áreas comunes", "regulation", "Piscina, rancho, salón de eventos, cancha y gimnasio.", "residents", 200, [
      "Las áreas comunes se reservan desde la app. Cada área tiene su horario, duración máxima y costo.",
      "La filial que reserva responde por los daños y por dejar el área limpia."
    ]);
    await doc("Circular: mantenimiento de ascensores", "circular", "Cierre programado del ascensor de la torre A.", "residents", 3, [
      "Se informa que el ascensor de la torre A estará fuera de servicio el próximo sábado de 8:00 a 12:00 por mantenimiento preventivo."
    ]);
    await doc("Formulario de mudanza", "form", "Complételo y entréguelo en la administración 48 h antes.", "residents", 90, [
      "Nombre del responsable: ____________________   Filial: ________",
      "Fecha y hora de la mudanza: ____________________",
      "Placa del vehículo: ________   Empresa de mudanzas: ____________________"
    ]);
    await doc("Presupuesto 2027 (borrador)", "financial", "Borrador para la junta directiva; no se publica en la app.", "staff", 7, [
      "Borrador del presupuesto 2027 para revisión de la junta directiva."
    ]);

    // ---------------------------------------------------------------- Inventario
    const [salon, rancho, piscina, gym] = [await amenity("Salón de eventos"), await amenity("Rancho BBQ"), await amenity("Piscina"), await amenity("Gimnasio")];
    const item = (code: string, name: string, category: string, location: string | null, amenityId: string | null, qty: number, value: number, cond: string, extra: { supplier?: string; months?: number; next?: number; brand?: string; serial?: string } = {}) =>
      id(
        `INSERT INTO inventory_items (code, name, category, location, amenity_id, quantity, unit_value, acquired_on, supplier_id, brand, serial, condition,
                                      maintenance_months, next_maintenance_on, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE - 500, $8, $9, $10, $11, $12, CURRENT_DATE + $13::int, fn_current_app_user()) RETURNING id`,
        [code, name, category, location, amenityId, qty, value, extra.supplier ?? null, extra.brand ?? null, extra.serial ?? null, cond, extra.months ?? null, extra.next ?? null]
      );
    await item("INV-001", "Sillas plegables", "furniture", "Bodega del salón", salon, 60, 12000, "good");
    await item("INV-002", "Mesas rectangulares", "furniture", "Bodega del salón", salon, 10, 45000, "good");
    const grill = await item("INV-003", "Parrilla de gas", "appliance", null, rancho, 1, 380000, "fair", { months: 6, next: -3, brand: "Weber" });
    const pump = await item("INV-004", "Bomba de la piscina", "equipment", "Cuarto de máquinas", piscina, 1, 650000, "good", { months: 3, next: 10, brand: "Pentair", serial: "PX-55821" });
    await item("INV-005", "Cámaras de seguridad", "security", "Entradas y parqueo", null, 8, 95000, "good", { supplier: alfa, months: 12, next: 120, brand: "Hikvision" });
    await item("INV-006", "Podadora", "garden", "Bodega de mantenimiento", null, 1, 210000, "fair", { months: 6, next: 45, brand: "Honda" });
    const treadmill = await item("INV-007", "Caminadora", "sports", null, gym, 2, 900000, "broken", { brand: "Life Fitness" });
    await item("INV-008", "Extintores", "security", "Pasillos de ambas torres", null, 12, 35000, "good", { months: 12, next: 60 });
    await client.query(
      `INSERT INTO inventory_logs (item_id, kind, happened_on, description, cost, supplier_id, created_by) VALUES
         ($1, 'maintenance', CURRENT_DATE - 185, 'Limpieza de quemadores y cambio de manguera', 25000, NULL, fn_current_app_user()),
         ($2, 'maintenance', CURRENT_DATE - 80, 'Cambio de sellos y revisión del motor', 60000, NULL, fn_current_app_user()),
         ($3, 'condition', CURRENT_DATE - 4, 'La banda de una de las dos caminadoras se rompió. Se rotuló fuera de servicio.', NULL, NULL, fn_current_app_user())`,
      [grill, pump, treadmill]
    );
    return true;
  });
  if (seeded) logger.info("[bootstrap] datos de demostración de gestión administrativa creados");
}
