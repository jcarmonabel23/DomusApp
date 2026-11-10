/**
 * @project DomusApp - Admin
 * @file src/app/suppliers/SupplierModal.tsx
 * @description Ficha de un proveedor: datos, contactos (uno principal), personal designado y contratos con su archivo
 */

import { useEffect, useState } from "react";
import { ActionIcon, Badge, Button, FileButton, Group, Modal, NumberInput, Select, Stack, Switch, Table, Tabs, Text, TextInput, Textarea } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconEdit, IconPlus, IconStar, IconTrash, IconUpload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from "@clients/apiClient";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { notifyError, notifySuccess } from "@utils/notify";
import { fmtDay, todayIso, useCurrency, useMoney } from "@/app/finance/shared";
import { SupplierFields, supplierPayload, type Supplier, type SupplierForm } from "./Page";
import { ACCEPT_FILES, FileLink, type FileRef } from "./shared";

interface Contact {
  id: string;
  names: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
}
interface Staff {
  id: string;
  names: string;
  idNumber: string | null;
  role: string | null;
  phone: string | null;
  schedule: string | null;
  isActive: boolean;
}
interface Contract {
  id: string;
  title: string;
  startsOn: string;
  endsOn: string | null;
  amount: number | null;
  frequency: string;
  notes: string | null;
  isCancelled: boolean;
  status: "active" | "upcoming" | "expiring" | "expired" | "cancelled";
  file: FileRef | null;
}
type Detail = Supplier & { contacts: Contact[]; staff: Staff[]; contracts: Contract[] };

const CONTRACT_STATUS: Record<Contract["status"], { label: string; color: string }> = {
  active: { label: "Vigente", color: "teal" },
  upcoming: { label: "Por iniciar", color: "blue" },
  expiring: { label: "Por vencer", color: "orange" },
  expired: { label: "Vencido", color: "red" },
  cancelled: { label: "Cancelado", color: "gray" }
};
const FREQUENCY: Record<string, string> = { monthly: "mensual", quarterly: "trimestral", yearly: "anual", one_time: "pago único" };

type Child =
  | { kind: "contacts"; id: string | null; names: string; role: string; phone: string; email: string; isPrimary: boolean }
  | { kind: "staff"; id: string | null; names: string; idNumber: string; role: string; phone: string; schedule: string; isActive: boolean }
  | { kind: "contracts"; id: string | null; title: string; startsOn: string; endsOn: string | null; amount: number | string; frequency: string; notes: string; isCancelled: boolean };

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? v.trim() || null : v]));

export default function SupplierModal({ supplierId, onClose }: Readonly<{ supplierId: string | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const can = useCan("SUPPLIERS");
  const money = useMoney();
  const currency = useCurrency();
  const [tab, setTab] = useState<string | null>("data");
  const [form, setForm] = useState<SupplierForm | null>(null);
  const [child, setChild] = useState<Child | null>(null);

  const q = useQuery({ queryKey: ["suppliers", "one", supplierId], queryFn: () => apiGet<Detail>(`/suppliers/${supplierId}`), enabled: Boolean(supplierId) });
  const s = q.data;

  useEffect(() => setTab("data"), [supplierId]);
  useEffect(() => {
    if (s)
      setForm({
        name: s.name,
        legalId: s.legalId ?? "",
        category: s.category,
        phone: s.phone ?? "",
        email: s.email ?? "",
        address: s.address ?? "",
        website: s.website ?? "",
        notes: s.notes ?? "",
        showToResidents: s.showToResidents,
        isActive: s.isActive
      });
  }, [s]);

  const done = (r: Detail, msg: string) => {
    qc.setQueryData(["suppliers", "one", supplierId], r);
    void qc.invalidateQueries({ queryKey: ["suppliers", "list"] });
    void qc.invalidateQueries({ queryKey: ["suppliers", "summary"] });
    void qc.invalidateQueries({ queryKey: ["supplier-options"] });
    notifySuccess(msg);
  };

  const saveData = useMutation({
    mutationFn: () => apiPut<Detail>(`/suppliers/${supplierId}`, supplierPayload(form!)),
    onSuccess: (r) => done(r, "Proveedor guardado"),
    onError: (err) => notifyError(err)
  });

  const saveChild = useMutation({
    mutationFn: () => {
      const { kind, id, ...body } = child!;
      const payload = child!.kind === "contracts" ? { ...clean(body), amount: child!.amount === "" ? null : Number(child!.amount) } : clean(body);
      return id ? apiPut<Detail>(`/suppliers/${kind}/${id}`, payload) : apiPost<Detail>(`/suppliers/${supplierId}/${kind}`, payload);
    },
    onSuccess: (r) => {
      done(r, "Guardado");
      setChild(null);
    },
    onError: (err) => notifyError(err)
  });

  const removeChild = useMutation({
    mutationFn: ({ kind, id }: { kind: Child["kind"]; id: string }) => apiDelete<Detail>(`/suppliers/${kind}/${id}`),
    onSuccess: (r) => done(r, "Eliminado"),
    onError: (err) => notifyError(err)
  });

  const upload = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => apiUpload<Detail>(`/suppliers/contracts/${id}/file`, file),
    onSuccess: (r) => done(r, "Archivo del contrato guardado"),
    onError: (err) => notifyError(err)
  });

  const edit = can("edit");
  const del = (kind: Child["kind"], id: string, what: string) => confirmDelete(what, () => removeChild.mutate({ kind, id }));
  const c = child;
  const setC = (p: Record<string, unknown>) => setChild((x) => (x ? ({ ...x, ...p } as Child) : x));
  const childValid = Boolean(c && (c.kind === "contracts" ? c.title.trim().length >= 3 && c.startsOn && (!c.endsOn || c.endsOn >= c.startsOn) : c.names.trim().length >= 2));

  return (
    <Modal opened={Boolean(supplierId)} onClose={onClose} size="70rem" title={s ? s.name : "Proveedor"}>
      {s && form ? (
        <Tabs value={tab} onChange={setTab}>
          <Tabs.List mb="md">
            <Tabs.Tab value="data">Datos</Tabs.Tab>
            <Tabs.Tab value="contacts">Contactos ({s.contacts.length})</Tabs.Tab>
            <Tabs.Tab value="staff">Personal ({s.staff.filter((x) => x.isActive).length})</Tabs.Tab>
            <Tabs.Tab value="contracts" rightSection={s.expiring > 0 ? <Badge size="xs" color="orange" circle>!</Badge> : undefined}>
              Contratos ({s.contracts.length})
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="data">
            <Stack>
              <SupplierFields f={form} set={(p) => setForm((x) => (x ? { ...x, ...p } : x))} />
              {edit && (
                <Group justify="flex-end">
                  <Button onClick={() => saveData.mutate()} loading={saveData.isPending} disabled={form.name.trim().length < 2}>
                    Guardar
                  </Button>
                </Group>
              )}
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="contacts">
            {edit && (
              <Group justify="flex-end" mb="sm">
                <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setChild({ kind: "contacts", id: null, names: "", role: "", phone: "", email: "", isPrimary: s.contacts.length === 0 })}>
                  Agregar contacto
                </Button>
              </Group>
            )}
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th>Cargo</Table.Th>
                  <Table.Th>Teléfono</Table.Th>
                  <Table.Th>Correo</Table.Th>
                  <Table.Th w={80} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {s.contacts.map((x) => (
                  <Table.Tr key={x.id}>
                    <Table.Td>
                      <Group gap={4}>
                        {x.isPrimary && <IconStar size={14} color="var(--mantine-color-yellow-6)" aria-label="Principal" />}
                        <Text size="sm">{x.names}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td>{x.role ?? "—"}</Table.Td>
                    <Table.Td>{x.phone ?? "—"}</Table.Td>
                    <Table.Td>{x.email ?? "—"}</Table.Td>
                    <Table.Td>
                      {edit && (
                        <Group gap={2}>
                          <ActionIcon variant="subtle" aria-label={`Editar ${x.names}`} onClick={() => setChild({ kind: "contacts", id: x.id, names: x.names, role: x.role ?? "", phone: x.phone ?? "", email: x.email ?? "", isPrimary: x.isPrimary })}>
                            <IconEdit size={14} />
                          </ActionIcon>
                          {can("delete") && (
                            <ActionIcon variant="subtle" color="red" aria-label={`Eliminar ${x.names}`} onClick={() => del("contacts", x.id, x.names)}>
                              <IconTrash size={14} />
                            </ActionIcon>
                          )}
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {s.contacts.length === 0 && (
              <Text size="sm" c="dimmed" ta="center" py="md">
                Sin contactos.
              </Text>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="staff">
            <Group justify="space-between" mb="sm">
              <Text size="sm" c="dimmed">
                Personas que el proveedor asigna al condominio (oficiales, conserjes, jardineros…).
              </Text>
              {edit && (
                <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setChild({ kind: "staff", id: null, names: "", idNumber: "", role: "", phone: "", schedule: "", isActive: true })}>
                  Agregar persona
                </Button>
              )}
            </Group>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Nombre</Table.Th>
                  <Table.Th>Identificación</Table.Th>
                  <Table.Th>Función</Table.Th>
                  <Table.Th>Horario</Table.Th>
                  <Table.Th>Teléfono</Table.Th>
                  <Table.Th w={80} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {s.staff.map((x) => (
                  <Table.Tr key={x.id} opacity={x.isActive ? 1 : 0.5}>
                    <Table.Td>
                      <Text size="sm">{x.names}</Text>
                      {!x.isActive && (
                        <Badge size="xs" color="gray">
                          ya no asignado
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>{x.idNumber ?? "—"}</Table.Td>
                    <Table.Td>{x.role ?? "—"}</Table.Td>
                    <Table.Td>{x.schedule ?? "—"}</Table.Td>
                    <Table.Td>{x.phone ?? "—"}</Table.Td>
                    <Table.Td>
                      {edit && (
                        <Group gap={2}>
                          <ActionIcon
                            variant="subtle"
                            aria-label={`Editar ${x.names}`}
                            onClick={() => setChild({ kind: "staff", id: x.id, names: x.names, idNumber: x.idNumber ?? "", role: x.role ?? "", phone: x.phone ?? "", schedule: x.schedule ?? "", isActive: x.isActive })}
                          >
                            <IconEdit size={14} />
                          </ActionIcon>
                          {can("delete") && (
                            <ActionIcon variant="subtle" color="red" aria-label={`Eliminar ${x.names}`} onClick={() => del("staff", x.id, x.names)}>
                              <IconTrash size={14} />
                            </ActionIcon>
                          )}
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {s.staff.length === 0 && (
              <Text size="sm" c="dimmed" ta="center" py="md">
                Sin personal registrado.
              </Text>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="contracts">
            {edit && (
              <Group justify="flex-end" mb="sm">
                <Button
                  size="xs"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => setChild({ kind: "contracts", id: null, title: "", startsOn: todayIso(), endsOn: null, amount: "", frequency: "monthly", notes: "", isCancelled: false })}
                >
                  Agregar contrato
                </Button>
              </Group>
            )}
            <Stack gap="sm">
              {s.contracts.map((x) => (
                <Group key={x.id} justify="space-between" p="sm" style={{ border: "1px solid var(--mantine-color-gray-3)", borderRadius: 8 }} wrap="nowrap">
                  <div>
                    <Group gap={6}>
                      <Text fw={600} size="sm">
                        {x.title}
                      </Text>
                      <Badge size="sm" variant="light" color={CONTRACT_STATUS[x.status].color}>
                        {CONTRACT_STATUS[x.status].label}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      {fmtDay(x.startsOn)} → {x.endsOn ? fmtDay(x.endsOn) : "indefinido"}
                      {x.amount != null ? ` · ${money(x.amount)} ${FREQUENCY[x.frequency]}` : ""}
                    </Text>
                    {x.notes && (
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {x.notes}
                      </Text>
                    )}
                  </div>
                  <Group gap="xs" wrap="nowrap">
                    {x.file && <FileLink file={x.file} label={x.title} size={44} />}
                    {edit && (
                      <>
                        <FileButton accept={ACCEPT_FILES} onChange={(file) => file && upload.mutate({ id: x.id, file })}>
                          {(props) => (
                            <Button {...props} size="xs" variant="default" leftSection={<IconUpload size={14} />} loading={upload.isPending && upload.variables?.id === x.id}>
                              {x.file ? "Reemplazar" : "Subir archivo"}
                            </Button>
                          )}
                        </FileButton>
                        <ActionIcon
                          variant="subtle"
                          aria-label={`Editar ${x.title}`}
                          onClick={() => setChild({ kind: "contracts", id: x.id, title: x.title, startsOn: x.startsOn, endsOn: x.endsOn, amount: x.amount ?? "", frequency: x.frequency, notes: x.notes ?? "", isCancelled: x.isCancelled })}
                        >
                          <IconEdit size={14} />
                        </ActionIcon>
                        {can("delete") && (
                          <ActionIcon variant="subtle" color="red" aria-label={`Eliminar ${x.title}`} onClick={() => del("contracts", x.id, x.title)}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        )}
                      </>
                    )}
                  </Group>
                </Group>
              ))}
              {s.contracts.length === 0 && (
                <Text size="sm" c="dimmed" ta="center" py="md">
                  Sin contratos.
                </Text>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      ) : (
        <Text c="dimmed">Cargando…</Text>
      )}

      <FormModal
        opened={Boolean(c)}
        onClose={() => setChild(null)}
        title={c ? `${c.id ? "Editar" : "Agregar"} ${c.kind === "contacts" ? "contacto" : c.kind === "staff" ? "persona" : "contrato"}` : ""}
        onSubmit={() => saveChild.mutate()}
        loading={saveChild.isPending}
        valid={childValid}
      >
        {c?.kind === "contacts" && (
          <>
            <TextInput label="Nombre" required maxLength={120} value={c.names} onChange={(e) => setC({ names: e.currentTarget.value })} />
            <TextInput label="Cargo" maxLength={80} value={c.role} onChange={(e) => setC({ role: e.currentTarget.value })} />
            <Group grow>
              <TextInput label="Teléfono" maxLength={30} value={c.phone} onChange={(e) => setC({ phone: e.currentTarget.value })} />
              <TextInput label="Correo" type="email" maxLength={120} value={c.email} onChange={(e) => setC({ email: e.currentTarget.value })} />
            </Group>
            <Switch label="Contacto principal" checked={c.isPrimary} onChange={(e) => setC({ isPrimary: e.currentTarget.checked })} />
          </>
        )}
        {c?.kind === "staff" && (
          <>
            <TextInput label="Nombre completo" required maxLength={120} value={c.names} onChange={(e) => setC({ names: e.currentTarget.value })} />
            <Group grow>
              <TextInput label="Identificación" maxLength={30} value={c.idNumber} onChange={(e) => setC({ idNumber: e.currentTarget.value })} />
              <TextInput label="Función" maxLength={80} value={c.role} onChange={(e) => setC({ role: e.currentTarget.value })} />
            </Group>
            <Group grow>
              <TextInput label="Horario" placeholder="L a V, 06:00–18:00" maxLength={120} value={c.schedule} onChange={(e) => setC({ schedule: e.currentTarget.value })} />
              <TextInput label="Teléfono" maxLength={30} value={c.phone} onChange={(e) => setC({ phone: e.currentTarget.value })} />
            </Group>
            <Switch label="Asignado actualmente" checked={c.isActive} onChange={(e) => setC({ isActive: e.currentTarget.checked })} />
          </>
        )}
        {c?.kind === "contracts" && (
          <>
            <TextInput label="Objeto del contrato" required maxLength={160} value={c.title} onChange={(e) => setC({ title: e.currentTarget.value })} />
            <Group grow>
              <DatePickerInput label="Inicio" valueFormat="DD/MM/YYYY" value={c.startsOn} onChange={(v) => setC({ startsOn: v ?? todayIso() })} />
              <DatePickerInput label="Fin" placeholder="Indefinido" clearable valueFormat="DD/MM/YYYY" value={c.endsOn} onChange={(v) => setC({ endsOn: v })} />
            </Group>
            <Group grow>
              <NumberInput label="Monto" prefix={`${currency.symbol} `} thousandSeparator min={0} decimalScale={2} value={c.amount} onChange={(v) => setC({ amount: v })} />
              <Select
                label="Frecuencia"
                data={Object.entries(FREQUENCY).map(([value, label]) => ({ value, label }))}
                value={c.frequency}
                onChange={(v) => setC({ frequency: v ?? "monthly" })}
                allowDeselect={false}
              />
            </Group>
            <Textarea label="Notas" autosize minRows={2} maxLength={1000} value={c.notes} onChange={(e) => setC({ notes: e.currentTarget.value })} />
            {c.id && <Switch label="Cancelado" checked={c.isCancelled} onChange={(e) => setC({ isCancelled: e.currentTarget.checked })} />}
            <Text size="xs" c="dimmed">
              El archivo firmado (PDF o imagen) se sube desde la lista de contratos.
            </Text>
          </>
        )}
      </FormModal>
    </Modal>
  );
}
