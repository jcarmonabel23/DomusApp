/**
 * @project DomusApp - Admin
 * @file src/app/inventory/ItemModal.tsx
 * @description Ficha de un bien (alta y edición), foto y bitácora: mantenimiento, reparación, traslado,
 *              cambio de estado, baja y notas
 */

import { useEffect, useState } from "react";
import { Badge, Button, Center, Divider, FileButton, Grid, Group, Image, Modal, NumberInput, Paper, Select, Stack, Text, TextInput, Textarea, Timeline } from "@mantine/core";
import { DatePickerInput } from "@mantine/dates";
import { IconCamera, IconPackage, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut, apiUpload } from "@clients/apiClient";
import { useCan } from "@modules/access-control/useCan";
import { confirmDelete } from "@utils/confirm";
import { notifyError, notifySuccess } from "@utils/notify";
import { fmtDay, todayIso, useCurrency, useMoney } from "@/app/finance/shared";
import { options, useSupplierOptions } from "@/app/suppliers/shared";
import { CATEGORY, CONDITION, LOG_KIND, type ItemDetail } from "./shared";

interface Form {
  code: string;
  name: string;
  category: string;
  location: string;
  amenityId: string | null;
  quantity: number | string;
  unitValue: number | string;
  acquiredOn: string | null;
  supplierId: string | null;
  brand: string;
  model: string;
  serial: string;
  condition: string;
  maintenanceMonths: number | string;
  nextMaintenanceOn: string | null;
  notes: string;
}

const blank = (): Form => ({
  code: "",
  name: "",
  category: "furniture",
  location: "",
  amenityId: null,
  quantity: 1,
  unitValue: "",
  acquiredOn: null,
  supplierId: null,
  brand: "",
  model: "",
  serial: "",
  condition: "good",
  maintenanceMonths: "",
  nextMaintenanceOn: null,
  notes: ""
});

interface LogForm {
  kind: string;
  happenedOn: string;
  description: string;
  cost: number | string;
  supplierId: string | null;
  condition: string | null;
  location: string;
  amenityId: string | null;
}

const blankLog = (): LogForm => ({ kind: "maintenance", happenedOn: todayIso(), description: "", cost: "", supplierId: null, condition: null, location: "", amenityId: null });

/** itemId: null = cerrado, "new" = alta */
export default function ItemModal({ itemId, onClose, onCreated }: Readonly<{ itemId: string | null; onClose: () => void; onCreated: (id: string) => void }>) {
  const qc = useQueryClient();
  const can = useCan("INVENTORY");
  const money = useMoney();
  const currency = useCurrency();
  const suppliers = useSupplierOptions("/inventory/options");
  const isNew = itemId === "new";
  const [f, setF] = useState<Form | null>(null);
  const [log, setLog] = useState<LogForm>(blankLog());

  const amenities = useQuery({
    queryKey: ["inventory", "options"],
    queryFn: () => apiGet<{ amenities: { id: string; name: string }[] }>("/inventory/options"),
    staleTime: 60_000
  });
  const amenityOptions = (amenities.data?.amenities ?? []).map((a) => ({ value: a.id, label: a.name }));

  const q = useQuery({ queryKey: ["inventory", "one", itemId], queryFn: () => apiGet<ItemDetail>(`/inventory/${itemId}`), enabled: Boolean(itemId) && !isNew });
  const it = isNew ? null : q.data;

  useEffect(() => {
    setLog(blankLog());
    if (isNew) setF(blank());
    else if (!itemId) setF(null);
  }, [itemId, isNew]);
  useEffect(() => {
    if (it)
      setF({
        code: it.code,
        name: it.name,
        category: it.category,
        location: it.location ?? "",
        amenityId: it.amenityId,
        quantity: it.quantity,
        unitValue: it.unitValue ?? "",
        acquiredOn: it.acquiredOn,
        supplierId: it.supplierId,
        brand: it.brand ?? "",
        model: it.model ?? "",
        serial: it.serial ?? "",
        condition: it.condition,
        maintenanceMonths: it.maintenanceMonths ?? "",
        nextMaintenanceOn: it.nextMaintenanceOn,
        notes: it.notes ?? ""
      });
  }, [it]);

  const done = (r: ItemDetail, msg: string) => {
    qc.setQueryData(["inventory", "one", r.id], r);
    void qc.invalidateQueries({ queryKey: ["inventory", "list"] });
    void qc.invalidateQueries({ queryKey: ["inventory", "summary"] });
    notifySuccess(msg);
  };

  const save = useMutation({
    mutationFn: () => {
      const x = f!;
      const t = (v: string) => v.trim() || null;
      const body = {
        ...x,
        location: t(x.location),
        brand: t(x.brand),
        model: t(x.model),
        serial: t(x.serial),
        notes: t(x.notes),
        quantity: Number(x.quantity) || 0,
        unitValue: x.unitValue === "" ? null : Number(x.unitValue),
        maintenanceMonths: x.maintenanceMonths === "" ? null : Number(x.maintenanceMonths)
      };
      return isNew ? apiPost<ItemDetail>("/inventory", body) : apiPut<ItemDetail>(`/inventory/${itemId}`, body);
    },
    onSuccess: (r) => {
      done(r, isNew ? "Bien registrado" : "Bien guardado");
      if (isNew) onCreated(r.id);
    },
    onError: (err) => notifyError(err)
  });

  const addLog = useMutation({
    mutationFn: () =>
      apiPost<ItemDetail>(`/inventory/${itemId}/logs`, {
        ...log,
        cost: log.cost === "" ? null : Number(log.cost),
        location: log.location.trim() || null
      }),
    onSuccess: (r) => {
      done(r, `${LOG_KIND[log.kind].label} registrado`);
      setLog(blankLog());
    },
    onError: (err) => notifyError(err)
  });

  const photo = useMutation({
    mutationFn: (file: File) => apiUpload<ItemDetail>(`/inventory/${itemId}/photo`, file),
    onSuccess: (r) => done(r, "Foto actualizada"),
    onError: (err) => notifyError(err)
  });

  const remove = useMutation({
    mutationFn: () => apiDelete(`/inventory/${itemId}`),
    onSuccess: () => {
      notifySuccess("Bien eliminado");
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  const editable = can(isNew ? "add_new" : "edit") && (isNew || it?.isActive !== false);
  const set = (p: Partial<Form>) => setF((x) => (x ? { ...x, ...p } : x));
  const setL = (p: Partial<LogForm>) => setLog((x) => ({ ...x, ...p }));
  const valid = Boolean(f && f.code.trim() && f.name.trim().length >= 2 && f.quantity !== "");
  const logValid =
    log.description.trim().length >= 3 && (log.kind !== "condition" || log.condition) && (log.kind !== "move" || log.location.trim() || log.amenityId);

  return (
    <Modal opened={Boolean(itemId)} onClose={onClose} size="75rem" title={isNew ? "Nuevo bien" : it ? `${it.code} · ${it.name}` : "Bien"}>
      {f ? (
        <Grid gutter="lg">
          <Grid.Col span={{ base: 12, md: isNew ? 12 : 7 }}>
            <Stack gap="sm">
              {it && (
                <Group gap="xs">
                  <Badge variant="light" color={it.isActive ? CONDITION[it.condition].color : "gray"}>
                    {it.isActive ? CONDITION[it.condition].label : "De baja"}
                  </Badge>
                  {it.maintenanceOverdue ? <Badge color="red">Mantenimiento vencido</Badge> : it.maintenanceDue ? <Badge color="orange">Mantenimiento próximo</Badge> : null}
                  <Text size="sm" c="dimmed">
                    Valor total: {money(it.totalValue)}
                  </Text>
                </Group>
              )}
              {it && !it.isActive && (
                <Text size="sm" c="red">
                  Dado de baja el {fmtDay(it.retiredAt?.slice(0, 10))}: {it.retireReason}
                </Text>
              )}
              <Group grow>
                <TextInput label="Código" required maxLength={30} placeholder="INV-010" value={f.code} onChange={(e) => set({ code: e.currentTarget.value })} disabled={!editable} />
                <TextInput label="Nombre" required maxLength={120} value={f.name} onChange={(e) => set({ name: e.currentTarget.value })} disabled={!editable} style={{ flexGrow: 2 }} />
              </Group>
              <Group grow>
                <Select label="Categoría" data={options(CATEGORY)} value={f.category} onChange={(v) => set({ category: v ?? "other" })} allowDeselect={false} disabled={!editable} />
                <Select
                  label="Estado"
                  data={Object.entries(CONDITION).map(([value, c]) => ({ value, label: c.label }))}
                  value={f.condition}
                  onChange={(v) => set({ condition: v ?? "good" })}
                  allowDeselect={false}
                  disabled={!editable}
                />
                <NumberInput label="Cantidad" min={0} value={f.quantity} onChange={(v) => set({ quantity: v })} disabled={!editable} />
                <NumberInput label="Valor unitario" prefix={`${currency.symbol} `} thousandSeparator min={0} decimalScale={2} value={f.unitValue} onChange={(v) => set({ unitValue: v })} disabled={!editable} />
              </Group>
              <Group grow>
                <Select label="Área común" placeholder="Ninguna" clearable data={amenityOptions} value={f.amenityId} onChange={(v) => set({ amenityId: v })} disabled={!editable} />
                <TextInput label="Ubicación" maxLength={120} placeholder="Bodega, cuarto de máquinas…" value={f.location} onChange={(e) => set({ location: e.currentTarget.value })} disabled={!editable} />
              </Group>
              <Group grow>
                <TextInput label="Marca" maxLength={80} value={f.brand} onChange={(e) => set({ brand: e.currentTarget.value })} disabled={!editable} />
                <TextInput label="Modelo" maxLength={80} value={f.model} onChange={(e) => set({ model: e.currentTarget.value })} disabled={!editable} />
                <TextInput label="Serie" maxLength={80} value={f.serial} onChange={(e) => set({ serial: e.currentTarget.value })} disabled={!editable} />
              </Group>
              <Group grow>
                <DatePickerInput label="Adquirido" clearable valueFormat="DD/MM/YYYY" value={f.acquiredOn} onChange={(v) => set({ acquiredOn: v as string | null })} disabled={!editable} />
                <Select label="Proveedor" placeholder="Ninguno" clearable searchable data={suppliers} value={f.supplierId} onChange={(v) => set({ supplierId: v })} disabled={!editable} />
              </Group>
              <Group grow>
                <NumberInput label="Mantenimiento cada (meses)" min={1} max={120} placeholder="No lleva" value={f.maintenanceMonths} onChange={(v) => set({ maintenanceMonths: v })} disabled={!editable} />
                <DatePickerInput label="Próximo mantenimiento" clearable valueFormat="DD/MM/YYYY" value={f.nextMaintenanceOn} onChange={(v) => set({ nextMaintenanceOn: v as string | null })} disabled={!editable} />
              </Group>
              <Textarea label="Notas" autosize minRows={2} maxLength={1000} value={f.notes} onChange={(e) => set({ notes: e.currentTarget.value })} disabled={!editable} />
              <Group justify="space-between">
                {!isNew && can("delete") ? (
                  <Button variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => confirmDelete(`${f.code} · ${f.name}`, () => remove.mutate())}>
                    Eliminar registro
                  </Button>
                ) : (
                  <span />
                )}
                {editable && (
                  <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
                    {isNew ? "Registrar" : "Guardar"}
                  </Button>
                )}
              </Group>
            </Stack>
          </Grid.Col>

          {it && (
            <Grid.Col span={{ base: 12, md: 5 }}>
              <Stack>
                <Paper withBorder radius="lg" style={{ overflow: "hidden" }} pos="relative">
                  {it.photo ? (
                    <Image src={it.photo.medium} alt={`Foto de ${it.name}`} h={220} fit="cover" />
                  ) : (
                    <Center h={160} bg="var(--mantine-color-gray-0)">
                      <IconPackage size={56} stroke={1.3} color="var(--mantine-color-gray-5)" />
                    </Center>
                  )}
                  {can("edit") && (
                    <FileButton accept="image/png,image/jpeg,image/webp" onChange={(file) => file && photo.mutate(file)}>
                      {(props) => (
                        <Button {...props} size="compact-xs" variant="white" leftSection={<IconCamera size={14} />} pos="absolute" bottom={8} right={8} loading={photo.isPending}>
                          {it.photo ? "Cambiar foto" : "Subir foto"}
                        </Button>
                      )}
                    </FileButton>
                  )}
                </Paper>

                {can("edit") && it.isActive && (
                  <Paper withBorder p="sm" radius="md">
                    <Stack gap="xs">
                      <Text fw={600} size="sm">
                        Registrar en la bitácora
                      </Text>
                      <Group grow>
                        <Select
                          data={Object.entries(LOG_KIND).map(([value, k]) => ({ value, label: k.label }))}
                          value={log.kind}
                          onChange={(v) => setL({ kind: v ?? "note" })}
                          allowDeselect={false}
                          size="xs"
                          aria-label="Tipo de registro"
                        />
                        <DatePickerInput size="xs" valueFormat="DD/MM/YYYY" value={log.happenedOn} onChange={(v) => setL({ happenedOn: (v as string) ?? todayIso() })} aria-label="Fecha" />
                      </Group>
                      {log.kind === "condition" && (
                        <Select
                          size="xs"
                          placeholder="Nuevo estado"
                          data={Object.entries(CONDITION).map(([value, c]) => ({ value, label: c.label }))}
                          value={log.condition}
                          onChange={(v) => setL({ condition: v })}
                        />
                      )}
                      {log.kind === "move" && (
                        <Group grow>
                          <Select size="xs" placeholder="Área común" clearable data={amenityOptions} value={log.amenityId} onChange={(v) => setL({ amenityId: v })} />
                          <TextInput size="xs" placeholder="Nueva ubicación" value={log.location} onChange={(e) => setL({ location: e.currentTarget.value })} />
                        </Group>
                      )}
                      <Textarea size="xs" placeholder={log.kind === "retire" ? "Motivo de la baja" : "Qué se hizo"} autosize minRows={2} maxLength={500} value={log.description} onChange={(e) => setL({ description: e.currentTarget.value })} />
                      {(log.kind === "maintenance" || log.kind === "repair") && (
                        <Group grow>
                          <NumberInput size="xs" placeholder="Costo" prefix={`${currency.symbol} `} thousandSeparator min={0} value={log.cost} onChange={(v) => setL({ cost: v })} />
                          <Select size="xs" placeholder="Proveedor" clearable searchable data={suppliers} value={log.supplierId} onChange={(v) => setL({ supplierId: v })} />
                        </Group>
                      )}
                      {log.kind === "maintenance" && it.maintenanceMonths && (
                        <Text size="xs" c="dimmed">
                          El próximo mantenimiento se calcula {it.maintenanceMonths} mes(es) después de esta fecha.
                        </Text>
                      )}
                      <Group justify="flex-end">
                        <Button size="xs" color={log.kind === "retire" ? "red" : undefined} onClick={() => addLog.mutate()} loading={addLog.isPending} disabled={!logValid}>
                          {log.kind === "retire" ? "Dar de baja" : "Registrar"}
                        </Button>
                      </Group>
                    </Stack>
                  </Paper>
                )}

                <Divider label="Bitácora" labelPosition="left" />
                {it.logs.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    Sin registros.
                  </Text>
                ) : (
                  <Timeline bulletSize={14} lineWidth={2}>
                    {it.logs.map((l) => (
                      <Timeline.Item
                        key={l.id}
                        color={LOG_KIND[l.kind].color}
                        title={
                          <Group gap={6}>
                            <Text size="sm" fw={600}>
                              {LOG_KIND[l.kind].label}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {fmtDay(l.happenedOn)}
                            </Text>
                          </Group>
                        }
                      >
                        <Text size="sm">{l.description}</Text>
                        <Text size="xs" c="dimmed">
                          {[l.cost != null ? money(l.cost) : null, l.supplierName, l.createdByName].filter(Boolean).join(" · ")}
                        </Text>
                      </Timeline.Item>
                    ))}
                  </Timeline>
                )}
              </Stack>
            </Grid.Col>
          )}
        </Grid>
      ) : (
        <Text c="dimmed">Cargando…</Text>
      )}
    </Modal>
  );
}
