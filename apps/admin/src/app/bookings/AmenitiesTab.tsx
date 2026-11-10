/**
 * @project DomusApp - Admin
 * @file src/app/bookings/AmenitiesTab.tsx
 * @description Áreas comunes: foto, reglamento, horario, días, bloques, duración máxima, anticipación, capacidad,
 *              costo, aprobación y morosidad
 */

import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  Center,
  Chip,
  FileButton,
  Group,
  Image,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea
} from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import { IconCamera, IconEdit, IconPlus } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost, apiPut, apiUpload } from "@clients/apiClient";
import FormModal from "@atoms/forms/FormModal";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import { useCurrency, useMoney } from "@/app/finance/shared";
import { AMENITY_ICON, WEEKDAY_LABEL, WEEKDAY_SHORT, durationText, useAmenities, type Amenity } from "./shared";

type Form = Omit<Amenity, "id" | "photo" | "upcoming" | "pending" | "cost" | "maxActivePerUnit"> & {
  id: string | null;
  cost: number | string;
  maxActivePerUnit: number | string;
};

const blank = (): Form => ({
  id: null,
  name: "",
  icon: "other",
  description: "",
  rules: "",
  mode: "exclusive",
  capacity: 20,
  openTime: "08:00",
  closeTime: "22:00",
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  slotMinutes: 60,
  maxDurationMinutes: 120,
  minAdvanceHours: 0,
  maxAdvanceDays: 30,
  cancelHours: 24,
  maxActivePerUnit: "",
  cost: 0,
  requiresApproval: false,
  blockDelinquent: false,
  isActive: true
});

function AmenityPhoto({ a, height = 150 }: Readonly<{ a: Pick<Amenity, "photo" | "icon" | "name">; height?: number }>) {
  const meta = AMENITY_ICON[a.icon] ?? AMENITY_ICON.other;
  if (a.photo) return <Image src={a.photo.card} alt={`Foto de ${a.name}`} h={height} fit="cover" />;
  const I = meta.icon;
  return (
    <Center h={height} bg={`var(--mantine-color-${meta.color}-0)`}>
      <I size={56} color={`var(--mantine-color-${meta.color}-6)`} stroke={1.4} />
    </Center>
  );
}

export default function AmenitiesTab() {
  const qc = useQueryClient();
  const can = useCan("BOOKINGS");
  const money = useMoney();
  const currency = useCurrency();
  const amenities = useAmenities();
  const [editing, setEditing] = useState<Form | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const { id, ...f } = editing!;
      const body = {
        ...f,
        description: f.description?.trim() || null,
        rules: f.rules?.trim() || null,
        cost: Number(f.cost) || 0,
        maxActivePerUnit: f.maxActivePerUnit === "" ? null : Number(f.maxActivePerUnit)
      };
      return id ? apiPut(`/bookings/amenities/${id}`, body) : apiPost("/bookings/amenities", body);
    },
    onSuccess: () => {
      notifySuccess("Área guardada");
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["bookings"] });
    },
    onError: (err) => notifyError(err)
  });

  const upload = useMutation({
    mutationFn: ({ id, file }: { id: string; file: File }) => apiUpload(`/bookings/amenities/${id}/photo`, file),
    onSuccess: () => {
      notifySuccess("Foto actualizada");
      void qc.invalidateQueries({ queryKey: ["bookings", "amenities"] });
    },
    onError: (err) => notifyError(err)
  });

  const durations = editing
    ? Array.from({ length: Math.floor(1440 / editing.slotMinutes) }, (_, i) => (i + 1) * editing.slotMinutes)
        .filter((m) => m <= 720)
        .map((m) => ({ value: String(m), label: durationText(m) }))
    : [];
  const valid = Boolean(
    editing &&
      editing.name.trim().length >= 2 &&
      editing.weekdays.length > 0 &&
      editing.closeTime > editing.openTime &&
      editing.maxDurationMinutes >= editing.slotMinutes &&
      editing.maxDurationMinutes % editing.slotMinutes === 0
  );

  return (
    <>
      <Group justify="space-between" mb="md">
        <Text size="sm" c="dimmed">
          Los residentes ven las áreas activas en la app y reservan en los horarios libres.
        </Text>
        {can("add_new") && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing(blank())}>
            Nueva área
          </Button>
        )}
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
        {(amenities.data ?? []).map((a) => (
          <Paper key={a.id} withBorder radius="lg" style={{ overflow: "hidden" }} opacity={a.isActive ? 1 : 0.6}>
            <Box pos="relative">
              <AmenityPhoto a={a} />
              {can("edit") && (
                <FileButton accept="image/png,image/jpeg,image/webp" onChange={(file) => file && upload.mutate({ id: a.id, file })}>
                  {(props) => (
                    <Button {...props} size="compact-xs" variant="white" leftSection={<IconCamera size={14} />} pos="absolute" bottom={8} right={8} loading={upload.isPending && upload.variables?.id === a.id}>
                      {a.photo ? "Cambiar foto" : "Subir foto"}
                    </Button>
                  )}
                </FileButton>
              )}
            </Box>
            <Stack gap={6} p="md">
              <Group justify="space-between" wrap="nowrap">
                <Text fw={700}>{a.name}</Text>
                {can("edit") && (
                  <Button
                    size="xs"
                    variant="subtle"
                    leftSection={<IconEdit size={14} />}
                    onClick={() => setEditing({ ...a, description: a.description ?? "", rules: a.rules ?? "", maxActivePerUnit: a.maxActivePerUnit ?? "" })}
                  >
                    Editar
                  </Button>
                )}
              </Group>
              <Group gap={6}>
                {!a.isActive && <Badge color="gray">Inactiva</Badge>}
                <Badge variant="light" color={a.mode === "shared" ? "cyan" : "blue"}>
                  {a.mode === "shared" ? `Compartida · ${a.capacity} pers.` : `Exclusiva · hasta ${a.capacity} pers.`}
                </Badge>
                {a.requiresApproval && <Badge variant="light" color="yellow">Con aprobación</Badge>}
                {a.blockDelinquent && <Badge variant="light" color="red">Al día</Badge>}
              </Group>
              <Text size="sm">
                {a.openTime}–{a.closeTime} · {a.weekdays.length === 7 ? "todos los días" : a.weekdays.map((d) => WEEKDAY_SHORT[d]).join(" ")}
              </Text>
              <Text size="xs" c="dimmed">
                Hasta {durationText(a.maxDurationMinutes)} · {a.minAdvanceHours ? `${a.minAdvanceHours} h antes` : "sin anticipación"} · hasta {a.maxAdvanceDays} días ·{" "}
                {a.cost > 0 ? money(a.cost) : "gratis"}
              </Text>
              <Text size="xs" c="dimmed">
                {a.upcoming ?? 0} próxima(s){a.pending ? ` · ${a.pending} por aprobar` : ""}
              </Text>
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>
      {amenities.data?.length === 0 && (
        <Text c="dimmed" ta="center" py="xl">
          Aún no hay áreas comunes. Agregue la piscina, el rancho o el salón para que los residentes reserven desde la app.
        </Text>
      )}

      <FormModal
        opened={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Editar ${editing.name}` : "Nueva área común"}
        onSubmit={() => save.mutate()}
        loading={save.isPending}
        valid={valid}
        size="xl"
      >
        {editing && (
          <Stack>
            <SimpleGrid cols={2}>
              <TextInput label="Nombre" required maxLength={80} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.currentTarget.value })} />
              <Select
                label="Tipo (ícono si no hay foto)"
                data={Object.entries(AMENITY_ICON).map(([value, m]) => ({ value, label: m.label }))}
                value={editing.icon}
                onChange={(v) => setEditing({ ...editing, icon: v ?? "other" })}
                allowDeselect={false}
              />
            </SimpleGrid>
            <Textarea label="Descripción" autosize minRows={2} maxLength={500} value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.currentTarget.value })} />
            <Textarea
              label="Reglamento de uso"
              description="El residente debe aceptarlo al reservar"
              autosize
              minRows={3}
              maxRows={10}
              maxLength={4000}
              value={editing.rules ?? ""}
              onChange={(e) => setEditing({ ...editing, rules: e.currentTarget.value })}
            />

            <Text fw={600} size="sm">
              Horario
            </Text>
            <Chip.Group multiple value={editing.weekdays.map(String)} onChange={(v) => setEditing({ ...editing, weekdays: v.map(Number).sort() })}>
              <Group gap={6}>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <Chip key={d} value={String(d)} size="sm" aria-label={WEEKDAY_LABEL[d]}>
                    {WEEKDAY_LABEL[d].slice(0, 3)}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
            <SimpleGrid cols={4}>
              <TimeInput label="Abre" value={editing.openTime} onChange={(e) => setEditing({ ...editing, openTime: e.currentTarget.value })} />
              <TimeInput label="Cierra" value={editing.closeTime} onChange={(e) => setEditing({ ...editing, closeTime: e.currentTarget.value })} error={editing.closeTime <= editing.openTime ? "Debe ser después de abrir" : undefined} />
              <Select
                label="Bloques de"
                data={[
                  { value: "30", label: "30 min" },
                  { value: "60", label: "1 h" },
                  { value: "120", label: "2 h" }
                ]}
                value={String(editing.slotMinutes)}
                onChange={(v) => {
                  const slot = Number(v ?? 60) as Form["slotMinutes"];
                  setEditing({ ...editing, slotMinutes: slot, maxDurationMinutes: Math.max(slot, Math.ceil(editing.maxDurationMinutes / slot) * slot) });
                }}
                allowDeselect={false}
              />
              <Select label="Duración máxima" data={durations} value={String(editing.maxDurationMinutes)} onChange={(v) => setEditing({ ...editing, maxDurationMinutes: Number(v ?? editing.slotMinutes) })} allowDeselect={false} />
            </SimpleGrid>

            <Text fw={600} size="sm">
              Uso
            </Text>
            <SimpleGrid cols={3}>
              <SegmentedControl
                value={editing.mode}
                onChange={(v) => setEditing({ ...editing, mode: v as Form["mode"] })}
                data={[
                  { value: "exclusive", label: "Exclusiva" },
                  { value: "shared", label: "Compartida" }
                ]}
              />
              <NumberInput
                label={editing.mode === "shared" ? "Personas a la vez" : "Capacidad (personas)"}
                min={1}
                max={2000}
                value={editing.capacity}
                onChange={(v) => setEditing({ ...editing, capacity: Number(v) || 1 })}
              />
              <NumberInput
                label="Reservas activas por filial"
                placeholder="Sin límite"
                min={1}
                max={50}
                value={editing.maxActivePerUnit}
                onChange={(v) => setEditing({ ...editing, maxActivePerUnit: v })}
              />
            </SimpleGrid>
            <Text size="xs" c="dimmed" mt={-8}>
              Exclusiva: un grupo a la vez (rancho, salón). Compartida: varias filiales a la vez hasta la capacidad (piscina, gimnasio).
            </Text>

            <Text fw={600} size="sm">
              Anticipación, costo y aprobación
            </Text>
            <SimpleGrid cols={4}>
              <NumberInput label="Anticipación mínima" suffix=" h" min={0} max={720} value={editing.minAdvanceHours} onChange={(v) => setEditing({ ...editing, minAdvanceHours: Number(v) || 0 })} />
              <NumberInput label="Reservar hasta" suffix=" días" min={1} max={365} value={editing.maxAdvanceDays} onChange={(v) => setEditing({ ...editing, maxAdvanceDays: Number(v) || 1 })} />
              <NumberInput
                label="Costo"
                min={0}
                decimalScale={currency.decimals}
                thousandSeparator=" "
                decimalSeparator=","
                prefix={currency.symbol}
                value={editing.cost}
                onChange={(v) => setEditing({ ...editing, cost: v })}
              />
              <NumberInput
                label="Cancelar sin cargo hasta"
                suffix=" h antes"
                min={0}
                max={720}
                value={editing.cancelHours}
                onChange={(v) => setEditing({ ...editing, cancelHours: Number(v) || 0 })}
              />
            </SimpleGrid>
            <Switch
              label="La administración aprueba cada reserva"
              description="Si no, la reserva queda confirmada al momento"
              checked={editing.requiresApproval}
              onChange={(e) => setEditing({ ...editing, requiresApproval: e.currentTarget.checked })}
            />
            <Switch
              label="Solo filiales al día"
              description="Las filiales con saldo vencido no pueden reservar esta área"
              checked={editing.blockDelinquent}
              onChange={(e) => setEditing({ ...editing, blockDelinquent: e.currentTarget.checked })}
            />
            {editing.id && <Switch label="Activa (visible en la app)" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.currentTarget.checked })} />}
            {Number(editing.cost) > 0 && (
              <Text size="xs" c="dimmed">
                El costo se carga al estado de cuenta de la filial al confirmarse la reserva, y se anula si la cancela con la anticipación indicada.
              </Text>
            )}
          </Stack>
        )}
      </FormModal>
    </>
  );
}
