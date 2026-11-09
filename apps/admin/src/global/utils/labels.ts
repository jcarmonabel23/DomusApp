/**
 * @project DomusApp - Admin
 * @file src/global/utils/labels.ts
 * @description Etiquetas en español de los valores de dominio (enums de la BD)
 */

export const KIND_LABEL: Record<string, string> = {
  condominium: "Condominio",
  residential: "Residencial",
  commercial: "Centro comercial",
  office: "Oficentro"
};

export const UNIT_KIND_LABEL: Record<string, string> = {
  house: "Casa",
  apartment: "Apartamento",
  commercial: "Local comercial",
  office: "Oficina",
  lot: "Lote",
  parking: "Parqueo",
  storage: "Bodega",
  other: "Otro"
};

export const OCCUPANCY_LABEL: Record<string, string> = {
  owner: "Propietario",
  rented: "Alquilada",
  vacant: "Desocupada"
};

export const OCCUPANCY_COLOR: Record<string, string> = { owner: "teal", rented: "violet", vacant: "gray" };

export const RELATION_LABEL: Record<string, string> = {
  owner: "Propietario",
  tenant: "Inquilino",
  resident: "Residente"
};

export const ROLE_LABEL: Record<string, string> = {
  admin: "Administrador",
  owner: "Propietario",
  tenant: "Inquilino",
  guard: "Guarda"
};

export const ROLE_COLOR: Record<string, string> = { admin: "domus", owner: "teal", tenant: "violet", guard: "orange" };

export const toOptions = (map: Record<string, string>) => Object.entries(map).map(([value, label]) => ({ value, label }));
