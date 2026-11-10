/**
 * @project DomusApp - API
 * @file src/demoHistory.ts
 * @description Datos de demostración de la Fase 8 (solo dev/qa, condominio DEMO): cinco meses de historia
 *              para que los reportes tengan tendencias: ingresos y salidas en la caseta, alertas de pánico
 *              atendidas con distintos tiempos de respuesta y casos ya resueltos con su calificación.
 *
 * Usa un generador pseudoaleatorio con semilla fija: la historia sale igual en cada base nueva.
 * Termina una semana antes de hoy para no mezclarse con la bitácora reciente de las otras fases.
 */

import { one, withTx } from "./db.js";
import { logger } from "./lib/logger.js";

/** mulberry32: pseudoaleatorio reproducible */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAYS_BACK = 155;
const UNTIL = 7;

const VISITORS = ["María Fernández", "José Quesada", "Ana Lucía Brenes", "Luis Diego Mora", "Karla Jiménez", "Esteban Vargas", "Daniela Rojas", "Pablo Chaves", "Sofía Araya", "Andrés Solís"];
const DELIVERY = ["Mensajero Rappi", "Uber Eats", "Correos de Costa Rica", "DHL Express", "Pedidos Ya", "Farmacia La Bomba"];
const SERVICE = ["Técnico de cable", "Fumigación Tropical", "Técnico de aire acondicionado", "Cerrajería Express", "Plomero"];
const EMPLOYEES = ["Carmen Solano Vega", "Rosa Méndez", "Jardinero Juan Pérez"];
const HOURS = [6, 7, 7, 7, 8, 8, 9, 10, 11, 12, 12, 13, 14, 15, 16, 17, 17, 18, 18, 18, 19, 19, 20, 21];

export async function seedDemoHistory(): Promise<void> {
  const palmas = await one<{ id: string }>(`SELECT id FROM condominiums WHERE code = 'DEMO'`);
  if (!palmas) return;
  const users = await one<{ owner: string; tenant: string; guard: string; admin: string }>(
    `SELECT (SELECT id FROM users WHERE email = 'propietario@domusapp.local') AS owner,
            (SELECT id FROM users WHERE email = 'inquilino@domusapp.local') AS tenant,
            (SELECT id FROM users WHERE email = 'guarda@domusapp.local') AS guard,
            (SELECT id FROM users WHERE email = 'admin.demo@domusapp.local') AS admin`
  );
  if (!users?.owner || !users.tenant || !users.guard || !users.admin) return;

  const seeded = await withTx({ condominiumId: palmas.id, userId: users.admin }, async (client) => {
    // Marca de "ya sembrado": cualquier ingreso de hace más de 45 días
    if (await one(`SELECT 1 FROM access_logs WHERE created_at < NOW() - INTERVAL '45 days' LIMIT 1`, [], client)) return false;
    const units = (await client.query<{ id: string; code: string }>(`SELECT id, code FROM units WHERE is_active ORDER BY code`)).rows;
    if (units.length === 0) return false;
    const byCode = new Map(units.map((u) => [u.code, u.id]));
    const a101 = byCode.get("A-101") ?? units[0].id;
    const b302 = byCode.get("B-302") ?? units[units.length - 1].id;

    const rand = rng(20261115);
    const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
    const between = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));

    // ------------------------------------------------------------ Bitácora de la caseta
    const log = { unit: [] as string[], kind: [] as string[], names: [] as string[], plate: [] as (string | null)[], status: [] as string[], day: [] as number[], minute: [] as number[], stay: [] as number[] };
    for (let d = DAYS_BACK; d >= UNTIL; d--) {
      const weekend = [0, 6].includes(new Date(Date.now() - d * 86_400_000).getDay());
      const count = between(2, 7) + (weekend ? 3 : 0);
      for (let i = 0; i < count; i++) {
        const r = rand();
        const kind = r < 0.3 ? "resident" : r < 0.5 ? "temporary" : r < 0.68 ? "delivery" : r < 0.82 ? (weekend ? "temporary" : "employee") : r < 0.92 ? "service" : "unannounced";
        const name =
          kind === "resident" ? "Residente" : kind === "delivery" ? pick(DELIVERY) : kind === "service" ? pick(SERVICE) : kind === "employee" ? pick(EMPLOYEES) : pick(VISITORS);
        const unit = kind === "employee" ? a101 : rand() < 0.45 ? pick([a101, b302]) : pick(units).id;
        const denied = (kind === "unannounced" && rand() < 0.35) || (kind === "temporary" && rand() < 0.03);
        const hour = kind === "employee" ? pick([6, 7, 7, 8]) : pick(HOURS);
        log.unit.push(unit);
        log.kind.push(kind);
        log.names.push(kind === "resident" ? `Residente ${units.find((u) => u.id === unit)?.code ?? ""}`.trim() : name);
        log.plate.push(kind === "delivery" || kind === "resident" || rand() < 0.35 ? `${pick(["BTR", "CRC", "MOT", "FKL", "HJD"])}${between(100, 999)}` : null);
        log.status.push(denied ? "denied" : "exited");
        log.day.push(d);
        log.minute.push(hour * 60 + between(0, 59));
        log.stay.push(kind === "delivery" ? between(3, 15) : kind === "employee" ? between(480, 600) : kind === "service" ? between(40, 180) : kind === "resident" ? between(60, 600) : between(30, 240));
      }
    }
    await client.query(
      `INSERT INTO access_logs (unit_id, kind, names, plate, status, response, responded_by, responded_at, entry_at, exit_at, entry_by, exit_by, created_by, created_at)
       SELECT x.u, x.k, x.n, x.p, x.s,
              CASE WHEN x.s = 'denied' THEN 'denied' END, CASE WHEN x.s = 'denied' THEN $10::uuid END, CASE WHEN x.s = 'denied' THEN t.ts + INTERVAL '2 minutes' END,
              CASE WHEN x.s = 'denied' THEN NULL ELSE t.ts END,
              CASE WHEN x.s = 'denied' THEN NULL ELSE t.ts + make_interval(mins => x.stay) END,
              CASE WHEN x.s = 'denied' THEN NULL ELSE $9::uuid END, CASE WHEN x.s = 'denied' THEN NULL ELSE $9::uuid END,
              $9::uuid, t.ts
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::int[]) AS x(u, k, n, p, s, d, m, stay)
        CROSS JOIN LATERAL (SELECT (CURRENT_DATE - x.d) + make_interval(mins => x.m) AS ts) t`,
      [log.unit, log.kind, log.names, log.plate, log.status, log.day, log.minute, log.stay, users.guard, users.owner]
    );

    // ------------------------------------------------------------ Alertas de pánico atendidas
    const ALERTS: { kind: string; resolution: string }[] = [
      { kind: "intruder", resolution: "Se revisó el perímetro con linterna; era un gato en el techo." },
      { kind: "medical", resolution: "Se llamó al 911 y se guió a la ambulancia hasta la casa." },
      { kind: "other", resolution: "Botón presionado por error; se confirmó con la residente." },
      { kind: "intruder", resolution: "Persona ajena en el parqueo; se le pidió salir y se reforzó la ronda." },
      { kind: "flood", resolution: "Fuga en la tubería del jardín; se cerró la llave de paso y se avisó al plomero." },
      { kind: "short_circuit", resolution: "Se bajó la cuchilla del medidor; el electricista llegó al día siguiente." },
      { kind: "accident", resolution: "Caída en las gradas sin lesiones graves; se colocó cinta antideslizante." },
      { kind: "robbery", resolution: "Robo de una bicicleta del parqueo de visitas; se entregó el video a la policía." },
      { kind: "other", resolution: "Prueba del sistema con la administración." },
      { kind: "medical", resolution: "Desmayo por calor; se le dio agua y se recuperó." },
      { kind: "intruder", resolution: "Ruidos en la tapia trasera; sin hallazgos." },
      { kind: "fire", resolution: "Humo de una parrilla en el rancho; falsa alarma." },
      { kind: "vandalism", resolution: "Rayones en la caseta; se denunció y se instaló otra cámara." },
      { kind: "other", resolution: "Se activó desde el bolso; sin novedad." }
    ];
    const al = { kind: [] as string[], unit: [] as string[], by: [] as string[], day: [] as number[], minute: [] as number[], ack: [] as number[], attend: [] as number[], res: [] as string[] };
    ALERTS.forEach((a, i) => {
      const owner = i % 3 !== 1;
      al.kind.push(a.kind);
      al.unit.push(owner ? a101 : b302);
      al.by.push(owner ? users.owner : users.tenant);
      al.day.push(Math.round(DAYS_BACK - (i * (DAYS_BACK - UNTIL - 5)) / ALERTS.length));
      al.minute.push(pick(HOURS) * 60 + between(0, 59));
      // Respuesta en caseta: casi siempre en segundos o pocos minutos; a veces se demora
      al.ack.push(rand() < 0.8 ? between(25, 240) : between(300, 720));
      al.attend.push(between(6, 45) * 60);
      al.res.push(a.resolution);
    });
    await client.query(
      `INSERT INTO alerts (unit_id, kind, status, raised_by, raised_at, acknowledged_by, acknowledged_at, attended_by, attended_at, resolution)
       SELECT x.u, x.k, 'attended', x.b, t.ts, $9::uuid, t.ts + make_interval(secs => x.ack), $9::uuid, t.ts + make_interval(secs => x.ack + x.att), x.r
         FROM unnest($1::uuid[], $2::text[], $3::uuid[], $4::int[], $5::int[], $6::int[], $7::int[], $8::text[]) AS x(u, k, b, d, m, ack, att, r)
        CROSS JOIN LATERAL (SELECT (CURRENT_DATE - x.d) + make_interval(mins => x.m) AS ts) t`,
      [al.unit, al.kind, al.by, al.day, al.minute, al.ack, al.attend, al.res, users.guard]
    );

    // ------------------------------------------------------------ Casos ya resueltos
    const CASES: { category: string; title: string; description: string; hours: number; rating: number | null }[] = [
      { category: "damage", title: "Bombillo quemado en el pasillo de la torre A", description: "El pasillo del segundo piso queda oscuro en la noche.", hours: 20, rating: 5 },
      { category: "complaint", title: "Música alta después de las 10 p. m.", description: "Los fines de semana hay música hasta la madrugada.", hours: 52, rating: 3 },
      { category: "damage", title: "Portón peatonal no cierra solo", description: "El brazo hidráulico perdió fuerza y queda abierto.", hours: 96, rating: 4 },
      { category: "suggestion", title: "Bicicletero techado", description: "Proponemos techar el bicicletero de visitas.", hours: 240, rating: null },
      { category: "damage", title: "Fuga en el riego de la zona verde", description: "Sale agua de un aspersor todo el día.", hours: 30, rating: 5 },
      { category: "improvement", title: "Más iluminación en el sendero", description: "El sendero hacia el gimnasio está muy oscuro.", hours: 310, rating: 4 },
      { category: "complaint", title: "Mascotas sin correa en el área verde", description: "Perros sueltos asustan a los niños.", hours: 72, rating: 3 },
      { category: "damage", title: "Grieta en la acera de la entrada", description: "Una losa se levantó y es fácil tropezar.", hours: 160, rating: 4 },
      { category: "damage", title: "Cámara 3 sin imagen", description: "La cámara del parqueo de visitas no graba.", hours: 26, rating: 5 },
      { category: "suggestion", title: "Horario extendido del gimnasio", description: "Abrir a las 5 a. m. entre semana.", hours: 120, rating: 4 }
    ];
    const start = (await one<{ n: number }>(`SELECT COALESCE(MAX(number), 0)::int AS n FROM cases`, [], client))!.n;
    const cs = { number: [] as number[], category: [] as string[], title: [] as string[], description: [] as string[], unit: [] as string[], by: [] as string[], day: [] as number[], hours: [] as number[], rating: [] as (number | null)[] };
    CASES.forEach((c, i) => {
      const owner = i % 2 === 0;
      cs.number.push(start + i + 1);
      cs.category.push(c.category);
      cs.title.push(c.title);
      cs.description.push(c.description);
      cs.unit.push(owner ? a101 : b302);
      cs.by.push(owner ? users.owner : users.tenant);
      cs.day.push(Math.round(DAYS_BACK - 5 - (i * (DAYS_BACK - UNTIL - 20)) / CASES.length));
      cs.hours.push(c.hours);
      cs.rating.push(c.rating);
    });
    await client.query(
      `INSERT INTO cases (number, category, title, description, unit_id, reported_by, priority, status, source, assignee,
                          resolved_at, closed_at, rating, created_at, updated_at)
       SELECT x.num, x.cat, x.t, x.d, x.u, x.b, 'normal', CASE WHEN x.r IS NULL THEN 'resolved' ELSE 'closed' END, 'app', 'Administración',
              t.ts + make_interval(hours => x.h), CASE WHEN x.r IS NULL THEN NULL ELSE t.ts + make_interval(hours => x.h + 18) END,
              x.r, t.ts, t.ts + make_interval(hours => x.h + 18)
         FROM unnest($1::int[], $2::text[], $3::text[], $4::text[], $5::uuid[], $6::uuid[], $7::int[], $8::int[], $9::int[]) AS x(num, cat, t, d, u, b, day, h, r)
        CROSS JOIN LATERAL (SELECT (CURRENT_DATE - x.day) + INTERVAL '9 hours' AS ts) t`,
      [cs.number, cs.category, cs.title, cs.description, cs.unit, cs.by, cs.day, cs.hours, cs.rating]
    );
    return true;
  });
  if (seeded) logger.info("[bootstrap] historia de demostración para reportes creada");
}
