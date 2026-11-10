/**
 * @project DomusApp - Admin
 * @file src/app/bookings/NewBookingModal.tsx
 * @description Reserva a nombre de una filial (queda aprobada; si el área tiene costo se carga a la filial)
 */

import { useEffect, useMemo, useState } from "react";
import { NumberInput, Select, SimpleGrid, Text, Textarea } from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@clients/apiClient";
import FormModal from "@atoms/forms/FormModal";
import { notifyError, notifySuccess } from "@utils/notify";
import { useUnitOptions } from "@/app/access/shared";
import { todayIso, useMoney } from "@/app/finance/shared";
import { durationText, useAmenities, type DayAvailability } from "./shared";

export interface NewBookingDefaults {
  amenityId?: string | null;
  date?: string;
  time?: string | null;
}

export default function NewBookingModal({ defaults, onClose }: Readonly<{ defaults: NewBookingDefaults | null; onClose: () => void }>) {
  const qc = useQueryClient();
  const money = useMoney();
  const units = useUnitOptions();
  const amenities = useAmenities();
  const [amenityId, setAmenityId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [date, setDate] = useState(todayIso());
  const [time, setTime] = useState<string | null>(null);
  const [minutes, setMinutes] = useState<string | null>(null);
  const [guests, setGuests] = useState<number | string>(1);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!defaults) return;
    setAmenityId(defaults.amenityId ?? null);
    setDate(defaults.date ?? todayIso());
    setTime(defaults.time ?? null);
    setUnitId(null);
    setGuests(1);
    setNotes("");
  }, [defaults]);

  const area = amenities.data?.find((a) => a.id === amenityId);
  useEffect(() => setMinutes(area ? String(area.slotMinutes) : null), [area]);

  const day = useQuery({
    queryKey: ["bookings", "availability", amenityId, date],
    queryFn: () => apiGet<DayAvailability>(`/bookings/amenities/${amenityId}/availability`, { date }),
    enabled: Boolean(defaults && amenityId && date)
  });
  const freeTimes = (day.data?.slots ?? []).filter((s) => s.status === "available").map((s) => ({ value: s.time, label: s.left !== undefined ? `${s.time} · ${s.left} libre(s)` : s.time }));
  const durations = useMemo(
    () => (area ? Array.from({ length: area.maxDurationMinutes / area.slotMinutes }, (_, i) => (i + 1) * area.slotMinutes).map((m) => ({ value: String(m), label: durationText(m) })) : []),
    [area]
  );

  const save = useMutation({
    mutationFn: () => apiPost("/bookings/list", { amenityId, unitId, date, time, minutes: Number(minutes), guests: Number(guests), notes: notes.trim() || null }),
    onSuccess: () => {
      notifySuccess("Reserva registrada; se avisó a la filial");
      void qc.invalidateQueries({ queryKey: ["bookings"] });
      void qc.invalidateQueries({ queryKey: ["finance"] });
      onClose();
    },
    onError: (err) => notifyError(err)
  });

  return (
    <FormModal
      opened={Boolean(defaults)}
      onClose={onClose}
      title="Reservar a nombre de una filial"
      onSubmit={() => save.mutate()}
      loading={save.isPending}
      valid={Boolean(amenityId && unitId && time && minutes && Number(guests) >= 1)}
      submitLabel="Reservar"
    >
      <SimpleGrid cols={2}>
        <Select
          label="Área"
          required
          data={(amenities.data ?? []).filter((a) => a.isActive).map((a) => ({ value: a.id, label: a.name }))}
          value={amenityId}
          onChange={(v) => {
            setAmenityId(v);
            setTime(null);
          }}
        />
        <Select label="Filial" required searchable data={units} value={unitId} onChange={setUnitId} />
        <DateInput
          label="Fecha"
          required
          valueFormat="DD/MM/YYYY"
          minDate={todayIso()}
          value={date}
          onChange={(v) => {
            setDate((v as string) ?? todayIso());
            setTime(null);
          }}
        />
        <Select
          label="Hora de inicio"
          required
          data={freeTimes}
          value={time}
          onChange={setTime}
          disabled={!amenityId}
          nothingFoundMessage="Sin horarios libres"
          placeholder={day.data && !day.data.open ? (day.data.reason ?? "Cerrado") : undefined}
        />
        <Select label="Duración" required data={durations} value={minutes} onChange={setMinutes} disabled={!area} />
        <NumberInput label="Personas" min={1} max={area?.capacity ?? 2000} value={guests} onChange={setGuests} />
      </SimpleGrid>
      <Textarea label="Notas (las ve la filial)" autosize minRows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
      {area && (
        <Text size="xs" c="dimmed">
          Queda aprobada directamente y no aplica la anticipación ni el límite por filial.
          {area.cost > 0 ? ` Se cargarán ${money(area.cost)} al estado de cuenta de la filial.` : ""}
        </Text>
      )}
    </FormModal>
  );
}
