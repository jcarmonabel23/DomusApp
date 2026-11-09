/**
 * @project DomusApp - API
 * @file src/lib/exports.ts
 * @description Exportación de tablas a Excel (exceljs) y PDF (pdfkit) con la identidad del condominio
 *
 * Se arman en el SERVIDOR: así el permiso `download` y el filtro por condominio (RLS) aplican
 * igual que en la pantalla, y el archivo no depende del navegador.
 * Las celdas de Excel se escriben como texto o fecha, nunca como fórmula (aunque empiecen con «=»).
 */

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { Response } from "express";

export interface ExportColumn<T> {
  header: string;
  /** Ancho relativo (PDF) y en caracteres (Excel) */
  width: number;
  value: (row: T) => string | number | Date | null;
}

export interface ExportSpec<T> {
  title: string;
  subtitle: string;
  condominium: string;
  color: string | null;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Zona horaria del condominio para las fechas */
  timezone: string;
  fileBase: string;
}

const DOMUS = "#1572d3";

const fmtDate = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("es-419", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(d);

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

/** Texto plano para PDF / celdas (fechas en la zona del condominio) */
function cellText(v: string | number | Date | null, tz: string): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return fmtDate(v, tz);
  return String(v);
}

export async function sendXlsx<T>(res: Response, spec: ExportSpec<T>): Promise<void> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "DomusApp";
  wb.created = new Date();
  const ws = wb.addWorksheet(spec.title.slice(0, 31), { views: [{ state: "frozen", ySplit: 4 }] });
  const color = (spec.color ?? DOMUS).replace("#", "FF");

  ws.mergeCells(1, 1, 1, spec.columns.length);
  ws.getCell(1, 1).value = `${spec.condominium} · ${spec.title}`;
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: color } };
  ws.mergeCells(2, 1, 2, spec.columns.length);
  ws.getCell(2, 1).value = spec.subtitle;
  ws.getCell(2, 1).font = { size: 10, color: { argb: "FF6B7280" } };

  const header = ws.getRow(4);
  spec.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    ws.getColumn(i + 1).width = c.width;
  });

  spec.rows.forEach((row, r) => {
    const xl = ws.getRow(5 + r);
    spec.columns.forEach((c, i) => {
      const v = c.value(row);
      // Fechas como texto en la zona del condominio: Excel no maneja zonas horarias
      xl.getCell(i + 1).value = v instanceof Date ? fmtDate(v, spec.timezone) : (v ?? null);
    });
  });
  ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + spec.rows.length, column: spec.columns.length } };

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${spec.fileBase}_${stamp()}.xlsx"`);
  res.setHeader("Content-Length", String(buffer.length));
  res.end(buffer);
}

export async function sendPdf<T>(res: Response, spec: ExportSpec<T>): Promise<void> {
  const doc = new PDFDocument({ size: "LETTER", layout: "landscape", margin: 36, bufferPages: true, info: { Title: spec.title, Creator: "DomusApp" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  const color = spec.color ?? DOMUS;
  const left = doc.page.margins.left;
  const usable = doc.page.width - left - doc.page.margins.right;
  const totalWeight = spec.columns.reduce((s, c) => s + c.width, 0);
  const widths = spec.columns.map((c) => (c.width / totalWeight) * usable);
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  const drawHeader = () => {
    doc.fillColor(color).font("Helvetica-Bold").fontSize(15).text(spec.condominium, left, 36);
    doc.fillColor("#111827").fontSize(12).text(spec.title);
    doc.fillColor("#6b7280").font("Helvetica").fontSize(9).text(spec.subtitle);
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(left, y, usable, 18).fill(color);
    let x = left;
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
    spec.columns.forEach((c, i) => {
      doc.text(c.header, x + 4, y + 5, { width: widths[i] - 8, lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.y = y + 22;
  };

  drawHeader();
  doc.font("Helvetica").fontSize(8);
  spec.rows.forEach((row, r) => {
    const texts = spec.columns.map((c) => cellText(c.value(row), spec.timezone));
    const height = Math.max(14, ...texts.map((t, i) => doc.heightOfString(t, { width: widths[i] - 8 }) + 6));
    if (doc.y + height > bottom()) {
      doc.addPage();
      drawHeader();
      doc.font("Helvetica").fontSize(8);
    }
    const y = doc.y;
    if (r % 2 === 1) doc.rect(left, y - 2, usable, height).fill("#f3f4f6");
    let x = left;
    doc.fillColor("#111827");
    texts.forEach((t, i) => {
      doc.text(t, x + 4, y + 1, { width: widths[i] - 8 });
      x += widths[i];
    });
    doc.y = y + height;
  });
  if (spec.rows.length === 0) doc.fillColor("#6b7280").text("Sin registros en el período.", left, doc.y + 6);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.fillColor("#9ca3af").fontSize(8).text(
      `Generado con DomusApp · ${fmtDate(new Date(), spec.timezone)} · Página ${i + 1} de ${range.count}`,
      left,
      doc.page.height - doc.page.margins.bottom - 10,
      { width: usable, align: "right", lineBreak: false }
    );
  }
  doc.end();
  await done;

  const buffer = Buffer.concat(chunks);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${spec.fileBase}_${stamp()}.pdf"`);
  res.setHeader("Content-Length", String(buffer.length));
  res.end(buffer);
}
