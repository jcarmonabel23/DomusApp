/**
 * @project DomusApp - Admin
 * @file src/app/people/PersonDrawer.tsx
 * @description Ficha de una persona: filiales vinculadas (alta/baja) y acceso a la app móvil
 */

import { useState } from "react";
import { ActionIcon, Alert, Badge, Button, Checkbox, Divider, Drawer, Group, Loader, Paper, Select, Stack, Text } from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconDeviceMobile, IconDeviceMobileOff, IconInfoCircle, IconLink, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPut } from "@clients/apiClient";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import { RELATION_LABEL, ROLE_LABEL, toOptions } from "@utils/labels";
import type { Unit } from "@/app/units/Page";
import type { Person } from "./Page";

interface Props {
  personId: string | null;
  onClose: () => void;
  onChanged: () => void;
}

export default function PersonDrawer({ personId, onClose, onChanged }: Readonly<Props>) {
  const qc = useQueryClient();
  const can = useCan("PEOPLE");
  const [unitId, setUnitId] = useState<string | null>(null);
  const [relation, setRelation] = useState("owner");
  const [isPrimary, setIsPrimary] = useState(false);

  const person = useQuery({
    queryKey: ["people", "detail", personId],
    queryFn: () => apiGet<Person>(`/people/${personId}`),
    enabled: Boolean(personId)
  });
  const units = useQuery({ queryKey: ["units", "", null], queryFn: () => apiGet<Unit[]>("/units"), enabled: Boolean(personId) && can("edit") });

  const changed = () => {
    void qc.invalidateQueries({ queryKey: ["people", "detail", personId] });
    onChanged();
  };

  const link = useMutation({
    mutationFn: () => apiPut(`/people/${personId}/units`, { unitId, relation, isPrimary }),
    onSuccess: () => {
      notifySuccess("Filial vinculada");
      setUnitId(null);
      setIsPrimary(false);
      changed();
    },
    onError: (err) => notifyError(err)
  });

  const unlink = useMutation({
    mutationFn: (uid: string) => apiDelete(`/people/${personId}/units/${uid}`),
    onSuccess: () => {
      notifySuccess("Filial desvinculada");
      changed();
    },
    onError: (err) => notifyError(err)
  });

  const grant = useMutation({
    mutationFn: () => apiPost<{ created: boolean; emailed: boolean; role: string }>(`/people/${personId}/access`, {}),
    onSuccess: (r) => {
      notifySuccess(
        r.created
          ? `Acceso creado como ${ROLE_LABEL[r.role]?.toLowerCase()}. ${r.emailed ? "Se enviaron las credenciales por correo." : "No se pudo enviar el correo."}`
          : `La cuenta ya existía: se le dio acceso como ${ROLE_LABEL[r.role]?.toLowerCase()}.`
      );
      changed();
    },
    onError: (err) => notifyError(err)
  });

  const revoke = useMutation({
    mutationFn: () => apiDelete(`/people/${personId}/access`),
    onSuccess: () => {
      notifySuccess("Acceso retirado");
      changed();
    },
    onError: (err) => notifyError(err)
  });

  const p = person.data;
  const linked = new Set(p?.units.map((u) => u.unitId));
  const unitOptions = (units.data ?? []).filter((u) => !linked.has(u.id)).map((u) => ({ value: u.id, label: u.tower ? `${u.code} (${u.tower})` : u.code }));

  const confirmRevoke = () =>
    modals.openConfirmModal({
      title: "Retirar acceso a la app",
      children: <Text size="sm">{p?.names} dejará de poder entrar a la app en este condominio. Su cuenta sigue existiendo.</Text>,
      labels: { confirm: "Retirar", cancel: "Cancelar" },
      confirmProps: { color: "red" },
      onConfirm: () => revoke.mutate()
    });

  return (
    <Drawer opened={Boolean(personId)} onClose={onClose} position="right" size="md" title={p?.names ?? "Persona"}>
      {!p ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : (
        <Stack>
          <Text size="sm" c="dimmed">
            {[p.idNumber, p.email, p.phone].filter(Boolean).join(" · ") || "Sin datos de contacto"}
          </Text>

          <Divider label="Filiales" labelPosition="left" />
          {p.units.length === 0 && (
            <Text size="sm" c="dimmed">
              Aún no está vinculada a ninguna filial.
            </Text>
          )}
          {p.units.map((u) => (
            <Paper key={u.unitId} withBorder radius="md" p="sm" className="flex items-center justify-between">
              <div>
                <Text size="sm" fw={600}>
                  {u.code} {u.tower && <Text span size="xs" c="dimmed">· {u.tower}</Text>}
                </Text>
                <Group gap={6} mt={2}>
                  <Badge size="sm" variant="light">
                    {RELATION_LABEL[u.relation] ?? u.relation}
                  </Badge>
                  {u.isPrimary && (
                    <Badge size="sm" variant="light" color="teal">
                      Contacto principal
                    </Badge>
                  )}
                </Group>
              </div>
              {can("edit") && (
                <ActionIcon variant="subtle" color="red" aria-label="Desvincular" loading={unlink.isPending && unlink.variables === u.unitId} onClick={() => unlink.mutate(u.unitId)}>
                  <IconTrash size={16} />
                </ActionIcon>
              )}
            </Paper>
          ))}

          {can("edit") && (
            <Paper withBorder radius="md" p="sm" className="bg-gray-50">
              <Stack gap="xs">
                <Select label="Vincular a filial" placeholder="Buscar filial" searchable data={unitOptions} value={unitId} onChange={setUnitId} nothingFoundMessage="Sin coincidencias" />
                <Group grow>
                  <Select data={toOptions(RELATION_LABEL)} value={relation} onChange={(v) => setRelation(v ?? "owner")} allowDeselect={false} />
                  <Checkbox label="Contacto principal" checked={isPrimary} onChange={(e) => setIsPrimary(e.currentTarget.checked)} />
                </Group>
                <Button size="xs" leftSection={<IconLink size={14} />} disabled={!unitId} loading={link.isPending} onClick={() => link.mutate()}>
                  Vincular
                </Button>
              </Stack>
            </Paper>
          )}

          <Divider label="App móvil" labelPosition="left" />
          {p.hasAccess ? (
            <Group justify="space-between">
              <Badge variant="light" color="domus" leftSection={<IconDeviceMobile size={12} />}>
                Acceso como {ROLE_LABEL[p.accessRole ?? ""]?.toLowerCase() ?? "residente"}
              </Badge>
              {can("configure") && (
                <Button size="xs" variant="light" color="red" leftSection={<IconDeviceMobileOff size={14} />} loading={revoke.isPending} onClick={confirmRevoke}>
                  Retirar acceso
                </Button>
              )}
            </Group>
          ) : (
            <Stack gap="xs">
              <Alert variant="light" icon={<IconInfoCircle size={18} />}>
                Con acceso, la persona entra a la app con su correo para reservar, autorizar visitas y usar el botón de pánico. Necesita correo y al menos una filial.
              </Alert>
              {can("configure") && (
                <Button
                  leftSection={<IconDeviceMobile size={16} />}
                  disabled={!p.email || p.units.length === 0 || !p.isActive}
                  loading={grant.isPending}
                  onClick={() => grant.mutate()}
                >
                  Dar acceso a la app
                </Button>
              )}
            </Stack>
          )}
        </Stack>
      )}
    </Drawer>
  );
}
