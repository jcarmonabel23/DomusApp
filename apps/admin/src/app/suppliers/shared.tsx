/**
 * @project DomusApp - Admin
 * @file src/app/suppliers/shared.tsx
 * @description Piezas comunes de la fase 7: categorías de proveedor, archivo adjunto (PDF o imagen) y
 *              opciones de proveedores para los selectores de casos, acuerdos e inventario
 */

import { Anchor, Group, Image, Paper, Text } from "@mantine/core";
import { IconFileTypePdf, IconPhoto } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@clients/apiClient";

export const SUPPLIER_CATEGORY: Record<string, string> = {
  security: "Seguridad",
  cleaning: "Limpieza",
  maintenance: "Mantenimiento",
  gardening: "Jardinería",
  elevators: "Ascensores",
  pools: "Piscinas",
  plumbing: "Fontanería",
  electrical: "Electricidad",
  pest_control: "Fumigación",
  administration: "Administración",
  other: "Otro"
};

export const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** Archivo subido (fileUrls de la API) */
export interface FileRef {
  kind: "pdf" | "image";
  preview: string | null;
  full: string;
}

/** Enlace a un archivo: miniatura si es imagen, ícono si es PDF (se descarga) */
export function FileLink({ file, label, size = 64 }: Readonly<{ file: FileRef; label: string; size?: number }>) {
  if (file.kind === "image" && file.preview) {
    return (
      <Anchor href={file.full} target="_blank" rel="noreferrer" aria-label={`Ver ${label}`}>
        <Image src={file.preview} alt={label} w={size} h={size} radius="sm" fit="cover" />
      </Anchor>
    );
  }
  return (
    <Anchor href={file.full} rel="noreferrer" aria-label={`Descargar ${label}`} underline="never">
      <Paper withBorder radius="sm" px="xs" py={6}>
        <Group gap={6} wrap="nowrap">
          {file.kind === "pdf" ? <IconFileTypePdf size={20} color="var(--mantine-color-red-6)" /> : <IconPhoto size={20} />}
          <Text size="xs" lineClamp={1} maw={180}>
            {label}
          </Text>
        </Group>
      </Paper>
    </Anchor>
  );
}

export interface SupplierOption {
  id: string;
  name: string;
  category: string;
  isActive: boolean;
}

/** Proveedores para un selector; cada módulo expone su propia ruta (no exige el permiso de Proveedores) */
export function useSupplierOptions(path: "/cases/supplier-options" | "/assemblies/supplier-options" | "/inventory/options") {
  const q = useQuery({
    queryKey: ["supplier-options", path],
    queryFn: async () => {
      const r = await apiGet<SupplierOption[] | { suppliers: SupplierOption[] }>(path);
      return Array.isArray(r) ? r : r.suppliers;
    },
    staleTime: 60_000
  });
  return (q.data ?? []).map((s) => ({ value: s.id, label: s.isActive ? s.name : `${s.name} (inactivo)` }));
}

export const ACCEPT_FILES = "application/pdf,image/png,image/jpeg,image/webp";
