/**
 * @project DomusApp - API
 * @file src/modules/files/images.ts
 * @description Imágenes subidas: validación, re-codificación, guardado, borrado y URLs firmadas
 *
 * Seguridad de la subida (igual que FabriHub):
 *  - Solo PNG, JPG o WebP, reconocidos por su firma de bytes (no por extensión ni Content-Type).
 *    SVG no se admite (puede llevar scripts).
 *  - Toda imagen se decodifica y se vuelve a codificar con sharp: se descartan EXIF (incluida la
 *    ubicación GPS de las fotos del teléfono) y cualquier contenido incrustado.
 *  - Límite de píxeles contra "bombas" de descompresión.
 *
 * Entrega: un <img> no puede enviar el token, así que la API firma la URL (HMAC con la clave del
 * servidor) al devolver el registro dueño de la imagen, que ya pasó por sesión, permiso y RLS.
 * La firma cubre condominio, archivo, variante y vencimiento; la URL es estable dentro de una
 * ventana de 6 h para que el navegador y la app la guarden en caché.
 */

import { createHash, randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import type pg from "pg";
import sharp from "sharp";
import { config } from "../../config.js";
import { one } from "../../db.js";
import { hmac, safeEqualHex } from "../../lib/crypto.js";
import { HttpError, badRequest } from "../../lib/http.js";
import { logger } from "../../lib/logger.js";
import { storage } from "../../lib/storage.js";

sharp.cache({ memory: 32, files: 0 });
sharp.concurrency(1);

export type FilePurpose = "condominium_logo" | "authorization_photo" | "payment_receipt" | "expense_receipt";

const MAX_PIXELS = 40_000_000;
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

type Op = (img: sharp.Sharp) => sharp.Sharp;

const inside = (w: number, h: number): Op => (i) => i.resize(w, h, { fit: "inside", withoutEnlargement: true });
const cover = (size: number): Op => (i) => i.resize(size, size, { fit: "cover", position: "attention" });
const square = (size: number): Op => (i) => i.resize(size, size, { fit: "contain", background: TRANSPARENT });
const webp = (op: Op, quality = 82): Op => (i) => op(i).webp({ quality });
const png = (op: Op): Op => (i) => op(i).png({ compressionLevel: 9 });

/** Variantes por uso. La primera siempre es "orig.webp" (la que se mide y se registra) */
export const PROFILES = {
  /** Foto de persona: completa (para el guarda) y miniaturas recortadas */
  photo: [
    { file: "orig.webp", op: webp(inside(1200, 1200), 82) },
    { file: "400.webp", op: webp(cover(400)) },
    { file: "96.webp", op: webp(cover(96)) }
  ],
  /** Comprobante o factura: legible completo y una vista previa */
  receipt: [
    { file: "orig.webp", op: webp(inside(2000, 2000), 85) },
    { file: "800.webp", op: webp(inside(800, 800), 80) }
  ],
  /** Logo: cabecera (alto 96), cuadrado para la app y PNG para documentos y correos */
  logo: [
    { file: "orig.webp", op: webp(inside(1600, 1600), 90) },
    { file: "h96.webp", op: webp(inside(640, 96), 90) },
    { file: "sq256.webp", op: webp(square(256), 90) },
    { file: "doc.png", op: png(inside(800, 240)) }
  ]
} satisfies Record<string, { file: string; op: Op }[]>;
export type ImageProfile = keyof typeof PROFILES;

const ALL_FILES = new Set(Object.values(PROFILES).flatMap((p) => p.map((v) => v.file)));

/** Cuerpo crudo de la subida: el tipo real se decide por los bytes, no por el Content-Type */
export const rawUpload = express.raw({ type: () => true, limit: `${config.UPLOAD_MAX_MB}mb` });

export function sniffImage(buf: Buffer): "png" | "jpeg" | "webp" | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "webp";
  return null;
}

const unsupported = () => new HttpError(415, "UNSUPPORTED_IMAGE", "Solo se admiten imágenes PNG, JPG o WebP");
const corrupt = () => badRequest("CORRUPT_IMAGE", "La imagen está dañada o no se puede leer");

interface Processed {
  variants: Map<string, Buffer>;
  width: number;
  height: number;
}

async function processImage(buf: Buffer, profile: ImageProfile): Promise<Processed> {
  const format = sniffImage(buf);
  if (!format) throw unsupported();

  let meta: sharp.Metadata;
  try {
    meta = await sharp(buf, { limitInputPixels: MAX_PIXELS }).metadata();
  } catch {
    throw corrupt();
  }
  if (meta.format !== format) throw unsupported();
  if (!meta.width || !meta.height || meta.width < 16 || meta.height < 16) {
    throw badRequest("IMAGE_TOO_SMALL", "La imagen debe medir al menos 16 × 16 px");
  }

  // rotate() aplica la orientación EXIF antes de descartarla; sin withMetadata() no se copia nada
  const base = () => sharp(buf, { limitInputPixels: MAX_PIXELS, pages: 1 }).rotate();
  try {
    const variants = new Map<string, Buffer>();
    let width = 0;
    let height = 0;
    for (const v of PROFILES[profile]) {
      const { data, info } = await v.op(base()).toBuffer({ resolveWithObject: true });
      variants.set(v.file, data);
      if (v.file === "orig.webp") ({ width, height } = info);
    }
    return { variants, width, height };
  } catch {
    throw corrupt();
  }
}

export interface StoredImage {
  id: string;
  storageKey: string;
  processed: Processed;
  sha: string;
}

/**
 * @function storeImage
 * @description Procesa la imagen y la escribe en el almacenamiento (fuera de la transacción).
 * Devuelve id y clave para registrarla con insertFileRow DENTRO de la transacción; si esta
 * falla, quien llama borra el contenido con removeStored.
 */
export async function storeImage(buf: Buffer, condominiumId: string, profile: ImageProfile): Promise<StoredImage> {
  if (!Buffer.isBuffer(buf) || !buf.length) throw badRequest("EMPTY_FILE", "No se recibió ningún archivo");
  const processed = await processImage(buf, profile);
  const id = randomUUID();
  const storageKey = `${condominiumId}/${id}`;
  for (const [file, data] of processed.variants) await storage.put(`${storageKey}/${file}`, data);
  return { id, storageKey, processed, sha: createHash("sha256").update(buf).digest("hex") };
}

export async function insertFileRow(
  client: pg.PoolClient,
  stored: StoredImage,
  input: { purpose: FilePurpose; originalName: string | null; originalMime: string; originalBytes: number }
): Promise<void> {
  await one(
    `INSERT INTO files (id, purpose, storage_key, mime_type, size_bytes, width, height, variants, sha256,
                        original_name, original_mime, original_bytes, created_by)
     VALUES ($1, $2, $3, 'image/webp', $4, $5, $6, $7, $8, $9, $10, $11, fn_current_app_user()) RETURNING id`,
    [
      stored.id,
      input.purpose,
      stored.storageKey,
      stored.processed.variants.get("orig.webp")!.length,
      stored.processed.width,
      stored.processed.height,
      [...stored.processed.variants.keys()],
      stored.sha,
      input.originalName,
      input.originalMime.slice(0, 60),
      input.originalBytes
    ],
    client
  );
}

/** Borra el contenido de un archivo (después del commit, o al deshacer una subida). Nunca lanza. */
export async function removeStored(storageKey: string | null | undefined): Promise<void> {
  if (!storageKey) return;
  try {
    await storage.remove(storageKey);
  } catch (err) {
    logger.warn({ err, storageKey }, "[files] no se pudo borrar el contenido");
  }
}

/** Nombre original enviado por el cliente (cabecera x-file-name, codificada con encodeURIComponent) */
export function originalName(req: Request): string | null {
  const raw = req.header("x-file-name");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).replace(/[\u0000-\u001f]/g, "").slice(0, 200) || null;
  } catch {
    return null;
  }
}

/** Clave de almacenamiento de un archivo (siempre <condominio>/<archivo>) */
export const fileKey = (condominiumId: string, fileId: string | null | undefined): string | null =>
  fileId ? `${condominiumId}/${fileId}` : null;

// ------------------------------------------------------------------ URLs firmadas

const WINDOW_SECONDS = 6 * 3600;

const signature = (key: string, file: string, exp: number) => hmac(`file:${key}/${file}:${exp}`).slice(0, 32);

/** URL firmada de una variante (relativa: el panel la sirve por su proxy; la app le antepone el host) */
export function signedUrl(storageKey: string, file: string): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = (Math.floor(now / WINDOW_SECONDS) + 2) * WINDOW_SECONDS;
  return `/api/v1/files/${storageKey}/${file}?exp=${exp}&sig=${signature(storageKey, file, exp)}`;
}

export function photoUrls(storageKey: string | null | undefined) {
  if (!storageKey) return null;
  return { thumb: signedUrl(storageKey, "96.webp"), medium: signedUrl(storageKey, "400.webp"), full: signedUrl(storageKey, "orig.webp") };
}

export function logoUrls(storageKey: string | null | undefined) {
  if (!storageKey) return null;
  return { header: signedUrl(storageKey, "h96.webp"), square: signedUrl(storageKey, "sq256.webp"), doc: signedUrl(storageKey, "doc.png") };
}

const CONTENT_TYPE: Record<string, string> = { webp: "image/webp", png: "image/png" };

/** GET /api/v1/files/:condominium/:file/:name?exp&sig — sin sesión: lo autoriza la firma */
export async function serveFile(req: Request, res: Response): Promise<void> {
  const { condominium, file, name } = req.params as Record<string, string>;
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig ?? "");
  const key = `${condominium}/${file}`;
  const now = Math.floor(Date.now() / 1000);

  const valid =
    /^[0-9a-f-]{36}$/.test(condominium) &&
    /^[0-9a-f-]{36}$/.test(file) &&
    ALL_FILES.has(name) &&
    Number.isInteger(exp) &&
    exp > now &&
    /^[0-9a-f]{32}$/.test(sig) &&
    safeEqualHex(sig, signature(key, name, exp));
  if (!valid) {
    res.status(403).json({ error: { code: "BAD_SIGNATURE", message: "Enlace de imagen inválido o vencido" } });
    return;
  }

  const data = await storage.get(`${key}/${name}`);
  if (!data) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Imagen no encontrada" } });
    return;
  }
  res.setHeader("Content-Type", CONTENT_TYPE[name.split(".").pop()!]);
  res.setHeader("Content-Length", String(data.length));
  res.setHeader("Cache-Control", `private, max-age=${exp - now}, immutable`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.end(data);
}

/**
 * @function replaceImage
 * @description Flujo completo de "subir y asociar": procesa, guarda, registra y asocia en una
 * transacción; borra la imagen anterior después del commit (o la nueva si algo falla).
 */
export async function replaceImage(opts: {
  req: Request;
  condominiumId: string;
  profile: ImageProfile;
  purpose: FilePurpose;
  withTx: <T>(fn: (client: pg.PoolClient) => Promise<T>) => Promise<T>;
  /** Asocia el archivo nuevo y devuelve el id del anterior (o null) */
  attach: (client: pg.PoolClient, fileId: string) => Promise<string | null>;
}): Promise<StoredImage> {
  const body = opts.req.body as Buffer;
  const stored = await storeImage(body, opts.condominiumId, opts.profile);
  let previous: string | null = null;
  try {
    previous = await opts.withTx(async (client) => {
      await insertFileRow(client, stored, {
        purpose: opts.purpose,
        originalName: originalName(opts.req),
        originalMime: opts.req.header("content-type") ?? "application/octet-stream",
        originalBytes: body.length
      });
      const prev = await opts.attach(client, stored.id);
      if (prev) await client.query(`DELETE FROM files WHERE id = $1`, [prev]);
      return prev;
    });
  } catch (err) {
    await removeStored(stored.storageKey);
    throw err;
  }
  await removeStored(fileKey(opts.condominiumId, previous));
  return stored;
}
