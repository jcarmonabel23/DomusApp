/**
 * @project DomusApp - Admin
 * @file src/app/suppliers/Page.tsx
 * @description Proveedores: indicadores, listado con vencimientos de contrato, exportes y ficha con
 *              contactos, personal designado y contratos
 */

import { useMemo, useState } from "react";
import { Badge, Button, Group, Paper, SegmentedControl, Select, SimpleGrid, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { IconEye, IconFileSpreadsheet, IconFileTypePdf, IconPlus, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDownload, apiGet, apiPost } from "@clients/apiClient";
import FormModal from "@atoms/forms/FormModal";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import { fmtDay } from "@/app/finance/shared";
import SupplierModal from "./SupplierModal";
import { SUPPLIER_CATEGORY, options } from "./shared";

export interface Supplier {
  id: string;
  name: string;
  legalId: string | null;
  category: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
  showToResidents: boolean;
  isActive: boolean;
  contacts: number;
  staff: number;
  activeContracts: number;
  nextEnd: string | null;
  expiring: number;
  expired: number;
  primaryContact: string | null;
}

export interface SupplierForm {
  name: string;
  legalId: string;
  category: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  notes: string;
  showToResidents: boolean;
  isActive: boolean;
}

export const blankSupplier = (): SupplierForm => ({
  name: "",
  legalId: "",
  category: "maintenance",
  phone: "",
  email: "",
  address: "",
  website: "",
  notes: "",
  showToResidents: false,
  isActive: true
});

/** Campos de la ficha (alta y edición) */
export function SupplierFields({ f, set }: Readonly<{ f: SupplierForm; set: (p: Partial<SupplierForm>) => void }>) {
  return (
    <>
      <Group grow>
        <TextInput label="Nombre" required maxLength={120} value={f.name} onChange={(e) => set({ name: e.currentTarget.value })} />
        <TextInput label="Cédula jurídica" maxLength={30} value={f.legalId} onChange={(e) => set({ legalId: e.currentTarget.value })} />
      </Group>
      <Group grow>
        <Select label="Categoría" data={options(SUPPLIER_CATEGORY)} value={f.category} onChange={(v) => set({ category: v ?? "other" })} allowDeselect={false} />
        <TextInput label="Teléfono" maxLength={30} value={f.phone} onChange={(e) => set({ phone: e.currentTarget.value })} />
      </Group>
      <Group grow>
        <TextInput label="Correo" type="email" maxLength={120} value={f.email} onChange={(e) => set({ email: e.currentTarget.value })} />
        <TextInput label="Sitio web" maxLength={200} value={f.website} onChange={(e) => set({ website: e.currentTarget.value })} />
      </Group>
      <TextInput label="Dirección" maxLength={200} value={f.address} onChange={(e) => set({ address: e.currentTarget.value })} />
      <Textarea label="Notas internas" description="Solo las ve la administración" autosize minRows={2} maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.currentTarget.value })} />
      <Group>
        <Switch
          label="Mostrar en el directorio de la app"
          description="Los residentes ven nombre, teléfono, correo y contacto principal"
          checked={f.showToResidents}
          onChange={(e) => set({ showToResidents: e.currentTarget.checked })}
        />
        <Switch label="Activo" checked={f.isActive} onChange={(e) => set({ isActive: e.currentTarget.checked })} />
      </Group>
    </>
  );
}

export const supplierPayload = (f: SupplierForm) => ({
  ...f,
  legalId: f.legalId.trim() || null,
  phone: f.phone.trim() || null,
  email: f.email.trim() || null,
  address: f.address.trim() || null,
  website: f.website.trim() || null,
  notes: f.notes.trim() || null
});

export default function SuppliersPage() {
  const qc = useQueryClient();
  const can = useCan("SUPPLIERS");
  const [category, setCategory] = useState<string | null>(null);
  const [active, setActive] = useState("true");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<SupplierForm | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const filters = { category, active, search: search.trim() || null };
  const summary = useQuery({
    queryKey: ["suppliers", "summary"],
    queryFn: () => apiGet<{ active: number; contracts: number; expiring: number; staff: number }>("/suppliers/summary")
  });
  const list = useQuery({ queryKey: ["suppliers", "list", filters], queryFn: () => apiGet<Supplier[]>("/suppliers", filters) });

  const create = useMutation({
    mutationFn: () => apiPost<{ id: string }>("/suppliers", supplierPayload(creating!)),
    onSuccess: (s) => {
      notifySuccess("Proveedor creado");
      setCreating(null);
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      void qc.invalidateQueries({ queryKey: ["supplier-options"] });
      setOpen(s.id);
    },
    onError: (err) => notifyError(err)
  });

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload("/suppliers/export", { ...filters, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  const s = summary.data;
  const cards: [string, string, string, string?][] = [
    ["Proveedores activos", String(s?.active ?? "—"), "con relación vigente"],
    ["Contratos vigentes", String(s?.contracts ?? "—"), "incluye los por vencer"],
    ["Por vencer", String(s?.expiring ?? "—"), "en los próximos 30 días", s?.expiring ? "orange" : undefined],
    ["Personal designado", String(s?.staff ?? "—"), "personas activas en el condominio"]
  ];

  const columns = useMemo<ColumnDef<Supplier, unknown>[]>(
    () => [
      {
        header: "Proveedor",
        cell: ({ row: { original: p } }) => (
          <div>
            <Group gap={6}>
              <Text size="sm" fw={600}>
                {p.name}
              </Text>
              {p.showToResidents && (
                <Badge size="xs" variant="light" color="teal" leftSection={<IconEye size={10} />}>
                  App
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              {p.legalId ?? ""}
            </Text>
          </div>
        )
      },
      { header: "Categoría", size: 130, cell: ({ row: { original: p } }) => <Badge variant="light">{SUPPLIER_CATEGORY[p.category]}</Badge> },
      {
        header: "Contacto",
        cell: ({ row: { original: p } }) => (
          <div>
            <Text size="sm">{p.primaryContact ?? "—"}</Text>
            <Text size="xs" c="dimmed">
              {[p.phone, p.email].filter(Boolean).join(" · ")}
            </Text>
          </div>
        )
      },
      { header: "Personal", size: 80, cell: ({ row: { original: p } }) => <Text size="sm">{p.staff}</Text> },
      {
        header: "Contratos",
        size: 190,
        cell: ({ row: { original: p } }) => (
          <div>
            <Group gap={4}>
              <Text size="sm">{p.activeContracts} vigente(s)</Text>
              {p.expiring > 0 && (
                <Badge size="xs" color="orange">
                  por vencer
                </Badge>
              )}
              {p.expired > 0 && (
                <Badge size="xs" color="red">
                  vencido
                </Badge>
              )}
            </Group>
            {p.nextEnd && (
              <Text size="xs" c="dimmed">
                Próximo fin: {fmtDay(p.nextEnd)}
              </Text>
            )}
          </div>
        )
      },
      {
        header: "Estado",
        size: 90,
        cell: ({ row: { original: p } }) => (
          <Badge color={p.isActive ? "teal" : "gray"} variant="light">
            {p.isActive ? "Activo" : "Inactivo"}
          </Badge>
        )
      }
    ],
    []
  );

  return (
    <div className="p-6">
      <ModuleHeader title="Proveedores" description="Empresas que dan servicio al condominio: contratos, personal designado y contactos" />

      <SimpleGrid cols={{ base: 2, md: 4 }} mb="lg">
        {cards.map(([label, value, hint, color]) => (
          <Paper key={label} withBorder radius="lg" p="md">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text fw={700} size="xl" c={color}>
              {summary.isLoading ? "—" : value}
            </Text>
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Group mb="md" justify="space-between" align="end">
        <Group align="end">
          <SegmentedControl
            value={active}
            onChange={setActive}
            data={[
              { value: "true", label: "Activos" },
              { value: "false", label: "Inactivos" },
              { value: "all", label: "Todos" }
            ]}
          />
          <TextInput label="Buscar" placeholder="Nombre, cédula o contacto" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={240} />
          <Select label="Categoría" placeholder="Todas" clearable data={options(SUPPLIER_CATEGORY)} value={category} onChange={setCategory} w={170} />
        </Group>
        <Group gap="xs">
          {can("download") && (
            <>
              <Button variant="light" color="teal" leftSection={<IconFileSpreadsheet size={16} />} loading={exporting === "xlsx"} onClick={() => exportAs("xlsx")}>
                Excel
              </Button>
              <Button variant="light" color="red" leftSection={<IconFileTypePdf size={16} />} loading={exporting === "pdf"} onClick={() => exportAs("pdf")}>
                PDF
              </Button>
            </>
          )}
          {can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(blankSupplier())}>
              Nuevo proveedor
            </Button>
          )}
        </Group>
      </Group>

      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(p) => p.id} onRowClick={(p) => setOpen(p.id)} emptyText="No hay proveedores con estos filtros" />

      <SupplierModal supplierId={open} onClose={() => setOpen(null)} />

      <FormModal
        opened={Boolean(creating)}
        onClose={() => setCreating(null)}
        title="Nuevo proveedor"
        onSubmit={() => create.mutate()}
        loading={create.isPending}
        valid={Boolean(creating && creating.name.trim().length >= 2)}
        size="lg"
      >
        {creating && <SupplierFields f={creating} set={(p) => setCreating((x) => (x ? { ...x, ...p } : x))} />}
      </FormModal>
    </div>
  );
}
