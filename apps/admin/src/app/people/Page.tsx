/**
 * @project DomusApp - Admin
 * @file src/app/people/Page.tsx
 * @description Personas del condominio: propietarios, inquilinos y residentes; su vínculo con las
 * filiales y su acceso a la app móvil
 */

import { useMemo, useState } from "react";
import { ActionIcon, Badge, Button, Group, Menu, SegmentedControl, SimpleGrid, Switch, Text, TextInput, Textarea } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconDeviceMobile, IconDots, IconEdit, IconHome, IconPlus, IconSearch, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDelete, apiGet, apiPost, apiPut } from "@clients/apiClient";
import { coreAuth } from "@auth/store/coreAuth";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { notifyError, notifySuccess } from "@utils/notify";
import { ROLE_LABEL } from "@utils/labels";

const RELATION_SHORT: Record<string, string> = { owner: "Prop.", tenant: "Inq.", resident: "Res." };
import PersonDrawer from "./PersonDrawer";

export interface Person {
  id: string;
  names: string;
  idNumber: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
  userId: string | null;
  accessRole: string | null;
  hasAccess: boolean;
  units: { unitId: string; code: string; tower: string | null; relation: string; isPrimary: boolean }[];
}

interface PersonForm {
  id: string | null;
  names: string;
  idNumber: string;
  email: string;
  phone: string;
  notes: string;
  isActive: boolean;
}

const newPerson = (): PersonForm => ({ id: null, names: "", idNumber: "", email: "", phone: "", notes: "", isActive: true });
const toForm = (p: Person): PersonForm => ({
  id: p.id,
  names: p.names,
  idNumber: p.idNumber ?? "",
  email: p.email ?? "",
  phone: p.phone ?? "",
  notes: p.notes ?? "",
  isActive: p.isActive
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function PeoplePage() {
  const qc = useQueryClient();
  const can = useCan("PEOPLE");
  const idLabel = coreAuth((s) => s.condominium?.country.personIdLabel) ?? "Identificación";
  const [q, setQ] = useState("");
  const [debouncedQ] = useDebouncedValue(q, 300);
  const [relation, setRelation] = useState("all");
  const [editing, setEditing] = useState<PersonForm | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["people", debouncedQ, relation],
    queryFn: () => apiGet<Person[]>("/people", { q: debouncedQ, relation: relation === "all" ? undefined : relation })
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["people"] });
    void qc.invalidateQueries({ queryKey: ["units"] });
  };

  const save = useMutation({
    mutationFn: (f: PersonForm) => (f.id ? apiPut(`/people/${f.id}`, f) : apiPost<{ id: string }>("/people", f)),
    onSuccess: (r, f) => {
      notifySuccess(f.id ? "Persona actualizada" : "Persona registrada");
      setEditing(null);
      refresh();
      // Recién creada: se abre su ficha para vincularla a una filial
      if (!f.id && r && typeof r === "object" && "id" in r) setOpenId((r as { id: string }).id);
    },
    onError: (err) => notifyError(err)
  });

  const remove = useMutation({
    mutationFn: (p: Person) => apiDelete(`/people/${p.id}`),
    onSuccess: () => {
      notifySuccess("Persona eliminada");
      refresh();
    },
    onError: (err) => notifyError(err)
  });

  const columns = useMemo<ColumnDef<Person, unknown>[]>(
    () => [
      {
        header: "Persona",
        cell: ({ row: { original: p } }) => (
          <div>
            <Text size="sm" fw={600}>
              {p.names}
            </Text>
            <Text size="xs" c="dimmed">
              {p.idNumber ?? "Sin identificación"}
            </Text>
          </div>
        )
      },
      {
        header: "Contacto",
        cell: ({ row: { original: p } }) => (
          <Text size="sm">
            {p.email ?? "—"}
            <Text span size="xs" c="dimmed" display="block">
              {p.phone ?? ""}
            </Text>
          </Text>
        )
      },
      {
        header: "Filiales",
        cell: ({ row: { original: p } }) =>
          p.units.length === 0 ? (
            <Text size="sm" c="dimmed">
              Sin filial
            </Text>
          ) : (
            <Group gap={4}>
              {p.units.map((u) => (
                <Badge key={u.unitId} variant="light" color={u.relation === "owner" ? "teal" : u.relation === "tenant" ? "violet" : "gray"} radius="sm">
                  {u.code} · {RELATION_SHORT[u.relation] ?? u.relation}
                </Badge>
              ))}
            </Group>
          )
      },
      {
        header: "App",
        size: 130,
        cell: ({ row: { original: p } }) =>
          p.hasAccess ? (
            <Badge variant="light" color="domus" leftSection={<IconDeviceMobile size={12} />}>
              {ROLE_LABEL[p.accessRole ?? ""] ?? "Con acceso"}
            </Badge>
          ) : (
            <Text size="xs" c="dimmed">
              Sin acceso
            </Text>
          )
      },
      {
        header: "Estado",
        size: 100,
        cell: ({ row: { original: p } }) => (
          <Badge variant="light" color={p.isActive ? "teal" : "gray"}>
            {p.isActive ? "Activa" : "Inactiva"}
          </Badge>
        )
      },
      {
        id: "actions",
        header: "",
        size: 60,
        cell: ({ row: { original: p } }) => (
          <Menu position="bottom-end" withinPortal>
            <Menu.Target>
              <ActionIcon variant="subtle" color="gray" aria-label="Acciones" onClick={(e) => e.stopPropagation()}>
                <IconDots size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
              <Menu.Item leftSection={<IconHome size={16} />} onClick={() => setOpenId(p.id)}>
                Filiales y acceso
              </Menu.Item>
              {can("edit") && (
                <Menu.Item leftSection={<IconEdit size={16} />} onClick={() => setEditing(toForm(p))}>
                  Editar
                </Menu.Item>
              )}
              {can("delete") && (
                <Menu.Item color="red" leftSection={<IconTrash size={16} />} onClick={() => confirmDelete(p.names, () => remove.mutate(p))}>
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

  const emailOk = !editing?.email.trim() || EMAIL_RE.test(editing.email.trim());
  const valid = Boolean(editing && editing.names.trim().length >= 2 && emailOk);

  return (
    <div className="p-6">
      <ModuleHeader
        title="Personas"
        description="Propietarios, inquilinos y residentes de cada filial"
        right={
          can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(newPerson())}>
              Nueva persona
            </Button>
          )
        }
      />

      <Group mb="md" justify="space-between">
        <TextInput placeholder={`Buscar por nombre, ${idLabel.toLowerCase()} o correo`} leftSection={<IconSearch size={16} />} value={q} onChange={(e) => setQ(e.currentTarget.value)} w={340} />
        <SegmentedControl
          value={relation}
          onChange={setRelation}
          data={[
            { value: "all", label: "Todas" },
            { value: "owner", label: "Propietarios" },
            { value: "tenant", label: "Inquilinos" },
            { value: "resident", label: "Residentes" }
          ]}
        />
      </Group>

      <DataTable
        data={list.data ?? []}
        columns={columns}
        loading={list.isLoading}
        total={list.data?.length}
        rowKey={(p) => p.id}
        onRowClick={(p) => setOpenId(p.id)}
        emptyText="No hay personas registradas"
      />

      <FormModal
        opened={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Editar persona" : "Nueva persona"}
        onSubmit={() => editing && save.mutate(editing)}
        loading={save.isPending}
        valid={valid}
        size="lg"
      >
        {editing && (
          <>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput label="Nombre completo" required value={editing.names} onChange={(e) => setEditing({ ...editing, names: e.currentTarget.value })} />
              <TextInput label={idLabel} value={editing.idNumber} onChange={(e) => setEditing({ ...editing, idNumber: e.currentTarget.value })} />
              <TextInput
                label="Correo"
                type="email"
                description="Necesario para darle acceso a la app"
                value={editing.email}
                error={!emailOk ? "Correo inválido" : null}
                onChange={(e) => setEditing({ ...editing, email: e.currentTarget.value })}
              />
              <TextInput label="Teléfono" value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.currentTarget.value })} />
            </SimpleGrid>
            <Textarea label="Notas" autosize minRows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.currentTarget.value })} />
            <Switch label="Activa" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.currentTarget.checked })} />
          </>
        )}
      </FormModal>

      <PersonDrawer personId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />
    </div>
  );
}
