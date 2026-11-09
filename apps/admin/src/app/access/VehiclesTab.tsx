/**
 * @project DomusApp - Admin
 * @file src/app/access/VehiclesTab.tsx
 * @description Vehículos de las filiales: el guarda los reconoce por la placa
 */

import { useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Group, Menu, Select, SimpleGrid, Switch, Text, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconDots, IconEdit, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDelete, apiGet, apiPost, apiPut } from "@clients/apiClient";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { notifyError, notifySuccess } from "@utils/notify";
import { toOptions } from "@utils/labels";
import { VEHICLE_KIND_LABEL, useUnitOptions } from "./shared";

interface Vehicle {
  id: string;
  unitId: string;
  unitCode: string;
  plate: string;
  kind: string;
  brand: string | null;
  model: string | null;
  color: string | null;
  notes: string | null;
  isActive: boolean;
}

interface VehicleForm {
  id: string | null;
  unitId: string | null;
  plate: string;
  kind: string;
  brand: string;
  model: string;
  color: string;
  notes: string;
  isActive: boolean;
}

const empty = (): VehicleForm => ({ id: null, unitId: null, plate: "", kind: "car", brand: "", model: "", color: "", notes: "", isActive: true });

export default function VehiclesTab() {
  const qc = useQueryClient();
  const can = useCan("ACCESS");
  const units = useUnitOptions();
  const [q, setQ] = useState("");
  const [debouncedQ] = useDebouncedValue(q, 300);
  const [editing, setEditing] = useState<VehicleForm | null>(null);

  const list = useQuery({ queryKey: ["access", "vehicles", debouncedQ], queryFn: () => apiGet<Vehicle[]>("/access/vehicles", { q: debouncedQ }) });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["access"] });

  const save = useMutation({
    mutationFn: (f: VehicleForm) => (f.id ? apiPut(`/access/vehicles/${f.id}`, f) : apiPost("/access/vehicles", f)),
    onSuccess: (_r, f) => {
      notifySuccess(f.id ? "Vehículo actualizado" : "Vehículo registrado");
      setEditing(null);
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const remove = useMutation({
    mutationFn: (v: Vehicle) => apiDelete(`/access/vehicles/${v.id}`),
    onSuccess: () => {
      notifySuccess("Vehículo eliminado");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Vehicle, unknown>[]>(
    () => [
      {
        header: "Placa",
        cell: ({ row: { original: v } }) => (
          <Text size="sm" fw={700} ff="monospace">
            {v.plate}
          </Text>
        )
      },
      { header: "Filial", cell: ({ row: { original: v } }) => <Text size="sm">{v.unitCode}</Text> },
      {
        header: "Vehículo",
        cell: ({ row: { original: v } }) => (
          <Text size="sm">
            {[v.brand, v.model].filter(Boolean).join(" ") || VEHICLE_KIND_LABEL[v.kind]}
            <Text span display="block" size="xs" c="dimmed">
              {[VEHICLE_KIND_LABEL[v.kind], v.color].filter(Boolean).join(" · ")}
            </Text>
          </Text>
        )
      },
      {
        header: "Estado",
        size: 100,
        cell: ({ row: { original: v } }) => (
          <Badge variant="light" color={v.isActive ? "teal" : "gray"}>
            {v.isActive ? "Activo" : "Inactivo"}
          </Badge>
        )
      },
      {
        id: "actions",
        header: "",
        size: 60,
        cell: ({ row: { original: v } }) =>
          (can("edit") || can("delete")) && (
            <Menu position="bottom-end" withinPortal>
              <Menu.Target>
                <ActionIcon variant="subtle" color="gray" aria-label="Acciones">
                  <IconDots size={18} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {can("edit") && (
                  <Menu.Item
                    leftSection={<IconEdit size={16} />}
                    onClick={() =>
                      setEditing({ ...v, brand: v.brand ?? "", model: v.model ?? "", color: v.color ?? "", notes: v.notes ?? "" })
                    }
                  >
                    Editar
                  </Menu.Item>
                )}
                {can("delete") && (
                  <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => confirmDelete(`el vehículo ${v.plate}`, () => remove.mutate(v))}>
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

  const plateOk = /^[A-Z0-9]{2,15}$/.test((editing?.plate ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""));
  const valid = Boolean(editing?.unitId && plateOk);

  return (
    <>
      <Group mb="md" justify="space-between">
        <TextInput placeholder="Placa, filial o marca" leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={280} />
        {can("add_new") && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(empty())}>
            Nuevo vehículo
          </Button>
        )}
      </Group>
      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} total={list.data?.length} rowKey={(v) => v.id} emptyText="No hay vehículos registrados" />

      <FormModal
        opened={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Vehículo ${editing.plate}` : "Nuevo vehículo"}
        onSubmit={() => editing && save.mutate(editing)}
        loading={save.isPending}
        valid={valid}
      >
        {editing && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Select label="Filial" required searchable data={units} value={editing.unitId} onChange={(v) => setEditing({ ...editing, unitId: v })} />
              <TextInput
                label="Placa"
                required
                value={editing.plate}
                onChange={(e) => setEditing({ ...editing, plate: e.currentTarget.value.toUpperCase() })}
                error={editing.plate && !plateOk ? "Solo letras y números (2 a 15)" : null}
              />
              <Select label="Tipo" data={toOptions(VEHICLE_KIND_LABEL)} value={editing.kind} onChange={(v) => setEditing({ ...editing, kind: v ?? "car" })} allowDeselect={false} />
              <TextInput label="Color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.currentTarget.value })} />
              <TextInput label="Marca" value={editing.brand} onChange={(e) => setEditing({ ...editing, brand: e.currentTarget.value })} />
              <TextInput label="Modelo" value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.currentTarget.value })} />
            </SimpleGrid>
            <TextInput label="Notas" value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.currentTarget.value })} />
            <Switch label="Activo" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.currentTarget.checked })} />
          </>
        )}
      </FormModal>
    </>
  );
}
