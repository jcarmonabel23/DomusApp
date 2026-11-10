/**
 * @project DomusApp - Admin
 * @file src/app/inventory/shared.ts
 * @description Inventario: tipos y etiquetas
 */

export interface Item {
  id: string;
  code: string;
  name: string;
  category: string;
  location: string | null;
  amenityId: string | null;
  amenityName: string | null;
  quantity: number;
  unitValue: number | null;
  totalValue: number;
  acquiredOn: string | null;
  supplierId: string | null;
  supplierName: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  condition: "good" | "fair" | "poor" | "broken";
  maintenanceMonths: number | null;
  nextMaintenanceOn: string | null;
  maintenanceDue: boolean;
  maintenanceOverdue: boolean;
  notes: string | null;
  isActive: boolean;
  retiredAt: string | null;
  retireReason: string | null;
  photo: { thumb: string; medium: string; full: string } | null;
}

export interface Log {
  id: string;
  kind: string;
  happenedOn: string;
  description: string;
  cost: number | null;
  supplierName: string | null;
  createdByName: string | null;
  createdAt: string;
}

export type ItemDetail = Item & { logs: Log[] };

export const CATEGORY: Record<string, string> = {
  furniture: "Mobiliario",
  equipment: "Equipo",
  appliance: "Electrodoméstico",
  electronics: "Electrónica",
  tools: "Herramienta",
  security: "Seguridad",
  sports: "Deportivo",
  garden: "Jardín",
  other: "Otro"
};

export const CONDITION: Record<Item["condition"], { label: string; color: string }> = {
  good: { label: "Bueno", color: "teal" },
  fair: { label: "Regular", color: "yellow" },
  poor: { label: "Malo", color: "orange" },
  broken: { label: "Dañado", color: "red" }
};

export const LOG_KIND: Record<string, { label: string; color: string }> = {
  maintenance: { label: "Mantenimiento", color: "blue" },
  repair: { label: "Reparación", color: "teal" },
  move: { label: "Traslado", color: "cyan" },
  condition: { label: "Cambio de estado", color: "orange" },
  retire: { label: "Baja", color: "red" },
  note: { label: "Nota", color: "gray" }
};
