/**
 * @project DomusApp - Admin
 * @file src/app/units/Page.tsx
 * @description Filiales del condominio activo: listado con filtros, alta individual o por lote, edición y baja
 */

import { useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Group, Menu, NumberInput, Paper, Select, SimpleGrid, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconDots, IconEdit, IconPlus, IconSearch, IconStack2, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDelete, apiGet, apiPost, apiPut } from "@clients/apiClient";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { notifyError, notifySuccess } from "@utils/notify";
import { OCCUPANCY_COLOR, OCCUPANCY_LABEL, RELATION_LABEL, UNIT_KIND_LABEL, toOptions } from "@utils/labels";
import BulkUnitsModal from "./BulkUnitsModal";

export interface Unit {
  id: string;
  code: string;
  tower: string | null;
  floor: string | null;
  kind: string;
  areaM2: number | null;
  aliquot: number | null;
  occupancy: string;
  notes: string | null;
  isActive: boolean;
  people: { personId: string; names: string; relation: string; isPrimary: boolean }[];
}

interface Summary {
  total: number;
  rented: number;
  vacant: number;
  aliquotTotal: number;
  towers: string[];
}

interface UnitForm {
  id: string | null;
  code: string;
  tower: string;
  floor: string;
  kind: string;
  areaM2: number | string;
  aliquot: number | string;
  occupancy: string;
  notes: string;
  isActive: boolean;
}

const newUnit = (): UnitForm => ({
  id: null,
  code: "",
  tower: "",
  floor: "",
  kind: "apartment",
  areaM2: "",
  aliquot: "",
  occupancy: "owner",
  notes: "",
  isActive: true
});

const toForm = (u: Unit): UnitForm => ({
  id: u.id,
  code: u.code,
  tower: u.tower ?? "",
  floor: u.floor ?? "",
  kind: u.kind,
  areaM2: u.areaM2 ?? "",
  aliquot: u.aliquot ?? "",
  occupancy: u.occupancy,
  notes: u.notes ?? "",
  isActive: u.isActive
});

const numOrNull = (v: number | string) => (v === "" || v === null ? null : Number(v));

export default function UnitsPage() {
  const qc = useQueryClient();
  const can = useCan("UNITS");
  const [q, setQ] = useState("");
  const [debouncedQ] = useDebouncedValue(q, 300);
  const [tower, setTower] = useState<string | null>(null);
  const [editing, setEditing] = useState<UnitForm | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const list = useQuery({
    queryKey: ["units", debouncedQ, tower],
    queryFn: () => apiGet<Unit[]>("/units", { q: debouncedQ, tower })
  });
  const summary = useQuery({ queryKey: ["units", "summary"], queryFn: () => apiGet<Summary>("/units/summary") });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["units"] });

  const save = useMutation({
    mutationFn: (f: UnitForm) => {
      const body = { ...f, areaM2: numOrNull(f.areaM2), aliquot: numOrNull(f.aliquot) };
      return f.id ? apiPut(`/units/${f.id}`, body) : apiPost("/units", body);
    },
    onSuccess: (_r, f) => {
      notifySuccess(f.id ? "Filial actualizada" : "Filial creada");
      setEditing(null);
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const remove = useMutation({
    mutationFn: (u: Unit) => apiDelete(`/units/${u.id}`),
    onSuccess: () => {
      notifySuccess("Filial eliminada");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Unit, unknown>[]>(
    () => [
      {
        header: "Filial",
        cell: ({ row: { original: u } }) => (
          <div>
            <Text size="sm" fw={600}>
              {u.code}
            </Text>
            <Text size="xs" c="dimmed">
              {[u.tower, u.floor && `Piso ${u.floor}`].filter(Boolean).join(" · ") || "—"}
            </Text>
          </div>
        )
      },
      { header: "Tipo", cell: ({ row: { original: u } }) => <Text size="sm">{UNIT_KIND_LABEL[u.kind] ?? u.kind}</Text> },
      {
        header: "Ocupación",
        cell: ({ row: { original: u } }) => (
          <Badge variant="light" color={OCCUPANCY_COLOR[u.occupancy] ?? "gray"}>
            {OCCUPANCY_LABEL[u.occupancy] ?? u.occupancy}
          </Badge>
        )
      },
      {
        header: "Personas",
        cell: ({ row: { original: u } }) =>
          u.people.length === 0 ? (
            <Text size="sm" c="dimmed">
              Sin personas
            </Text>
          ) : (
            <div>
              {u.people.slice(0, 3).map((p) => (
                <Text key={p.personId} size="sm" lineClamp={1}>
                  {p.names}{" "}
                  <Text span size="xs" c="dimmed">
                    · {RELATION_LABEL[p.relation] ?? p.relation}
                    {p.isPrimary ? " (principal)" : ""}
                  </Text>
                </Text>
              ))}
              {u.people.length > 3 && (
                <Text size="xs" c="dimmed">
                  y {u.people.length - 3} más
                </Text>
              )}
            </div>
          )
      },
      {
        header: "Área / alícuota",
        cell: ({ row: { original: u } }) => (
          <Text size="sm">
            {u.areaM2 ? `${u.areaM2} m²` : "—"}
            <Text span size="xs" c="dimmed" display="block">
              {u.aliquot !== null ? `${u.aliquot}%` : "Sin alícuota"}
            </Text>
          </Text>
        )
      },
      {
        header: "Estado",
        size: 100,
        cell: ({ row: { original: u } }) => (
          <Badge variant="light" color={u.isActive ? "teal" : "gray"}>
            {u.isActive ? "Activa" : "Inactiva"}
          </Badge>
        )
      },
      {
        id: "actions",
        header: "",
        size: 60,
        cell: ({ row: { original: u } }) =>
          (can("edit") || can("delete")) && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Acciones">
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {can("edit") && (
                  <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => setEditing(toForm(u))}>
                    Editar
                  </Menu.Item>
                )}
                {can("delete") && (
                  <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => confirmDelete(`la filial ${u.code}`, () => remove.mutate(u))}>
                    Eliminar
                  </Menu.Item>
                )}
              </Menu.Dropdown>
            </Menu>
          )
      }
    ],
    [can, remove]
  );

  const s = summary.data;
  const valid = Boolean(editing && editing.code.trim() && editing.kind && editing.occupancy);

  return (
    <div className="p-6">
      <ModuleHeader
        title="Filiales"
        description="Casas, apartamentos, locales y oficinas del condominio"
        right={
          can("add_new") && (
            <>
              <Button variant="light" leftSection={<IconStack2 size={16} />} onClick={() => setBulkOpen(true)}>
                Generar por lote
              </Button>
              <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(newUnit())}>
                Nueva filial
              </Button>
            </>
          )
        }
      />

      <SimpleGrid cols={{ base: 2, md: 4 }} mb="md">
        {[
          ["Filiales activas", s?.total],
          ["Alquiladas", s?.rented],
          ["Desocupadas", s?.vacant],
          ["Suma de alícuotas", s ? `${Number(s.aliquotTotal.toFixed(4))}%` : undefined]
        ].map(([label, value]) => (
          <Paper key={label as string} withBorder radius="lg" p="md">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text fw={700} size="lg">
              {value ?? "—"}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Group mb="md">
        <TextInput placeholder="Buscar por código o persona" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={300} />
        {(s?.towers.length ?? 0) > 0 && (
          <Select placeholder="Todas las torres" clearable data={(s?.towers ?? []).map((t) => ({ value: t, label: t }))} value={tower} onChange={setTower} w={200} />
        )}
      </Group>

      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} total={list.data?.length} rowKey={(u) => u.id} emptyText="No hay filiales; créelas una a una o genérelas por lote" />

      <FormModal
        opened={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Editar filial ${editing.code}` : "Nueva filial"}
        onSubmit={() => editing && save.mutate(editing)}
        loading={save.isPending}
        valid={valid}
        size="lg"
      >
        {editing && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 3 }}>
              <TextInput label="Código" required placeholder="A-101" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.currentTarget.value })} />
              <TextInput label="Torre / bloque" value={editing.tower} onChange={(e) => setEditing({ ...editing, tower: e.currentTarget.value })} />
              <TextInput label="Piso" value={editing.floor} onChange={(e) => setEditing({ ...editing, floor: e.currentTarget.value })} />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select label="Tipo" required data={toOptions(UNIT_KIND_LABEL)} value={editing.kind} onChange={(v) => setEditing({ ...editing, kind: v ?? "apartment" })} allowDeselect={false} />
              <Select label="Ocupación" required data={toOptions(OCCUPANCY_LABEL)} value={editing.occupancy} onChange={(v) => setEditing({ ...editing, occupancy: v ?? "owner" })} allowDeselect={false} />
              <NumberInput label="Área (m²)" min={0} decimalScale={2} value={editing.areaM2} onChange={(v) => setEditing({ ...editing, areaM2: v })} />
              <NumberInput
                label="Alícuota (%)"
                description="Porcentaje de participación en las cuotas"
                min={0}
                max={100}
                decimalScale={4}
                value={editing.aliquot}
                onChange={(v) => setEditing({ ...editing, aliquot: v })}
              />
            </SimpleGrid>
            <Textarea label="Notas" autosize minRows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.currentTarget.value })} />
            <Switch label="Activa" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.currentTarget.checked })} />
          </>
        )}
      </FormModal>

      <BulkUnitsModal opened={bulkOpen} onClose={() => setBulkOpen(false)} onDone={refresh} />
    </div>
  );
}
