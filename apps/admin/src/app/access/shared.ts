/**
 * @project DomusApp - Admin
 * @file src/app/access/shared.ts
 * @description Tipos y etiquetas del control de acceso
 */

import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@clients/apiClient";

export const ACCESS_KIND_LABEL: Record<string, string> = {
  temporary: "Temporal",
  permanent: "Permanente",
  employee: "Empleado",
  resident: "Residente",
  unannounced: "No anunciada",
  delivery: "Entrega",
  service: "Servicio"
};

export const LOG_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Esperando", color: "orange" },
  inside: { label: "Adentro", color: "teal" },
  exited: { label: "Salió", color: "gray" },
  denied: { label: "Rechazado", color: "red" }
};

export const VEHICLE_KIND_LABEL: Record<string, string> = {
  car: "Automóvil",
  motorcycle: "Motocicleta",
  truck: "Camión",
  bicycle: "Bicicleta",
  other: "Otro"
};

export const WEEKDAYS = ["L", "K", "M", "J", "V", "S", "D"];

export interface Photo {
  thumb: string;
  medium: string;
  full: string;
}

/** Filiales para filtros y formularios (código y torre) */
export function useUnitOptions() {
  const q = useQuery({
    queryKey: ["units", "options"],
    queryFn: () => apiGet<{ id: string; code: string; tower: string | null }[]>("/units"),
    staleTime: 60_000
  });
  return (q.data ?? []).map((u) => ({ value: u.id, label: u.tower ? `${u.code} · ${u.tower}` : u.code }));
}
