/**
 * @project DomusApp - Admin
 * @file src/app/bookings/CalendarTab.tsx
 * @description Calendario semanal por hora de un área: disponible, reservado, por aprobar, feriado y no disponible.
 *              Tocar una reserva la abre; tocar un horario libre reserva a nombre de una filial.
 */

import { Fragment, useEffect, useState } from "react";
import { ActionIcon, Badge, Box, Button, Group, Paper, ScrollArea, Select, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { IconChevronLeft, IconChevronRight, IconPlus } from "@tabler/icons-react";
import { useQueries } from "@tanstack/react-query";
import { apiGet } from "@clients/apiClient";
import { useCan } from "@modules/access-control/useCan";
import { todayIso } from "@/app/finance/shared";
import BookingModal from "./BookingModal";
import NewBookingModal, { type NewBookingDefaults } from "./NewBookingModal";
import { SLOT_STYLE, addDays, dayLabel, isoDow, mondayOf, useAmenities, type DayAvailability, type Slot } from "./shared";

const LEGEND = ["available", "reserved", "pending", "holiday", "unavailable", "past"] as const;

export default function CalendarTab() {
  const can = useCan("BOOKINGS");
  const amenities = useAmenities();
  const [amenityId, setAmenityId] = useState<string | null>(null);
  const [week, setWeek] = useState(mondayOf(todayIso()));
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<NewBookingDefaults | null>(null);

  const active = (amenities.data ?? []).filter((a) => a.isActive);
  useEffect(() => {
    if (!amenityId && active[0]) setAmenityId(active[0].id);
  }, [amenityId, active]);
  const area = active.find((a) => a.id === amenityId);

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const results = useQueries({
    queries: days.map((date) => ({
      queryKey: ["bookings", "availability", amenityId, date],
      queryFn: () => apiGet<DayAvailability>(`/bookings/amenities/${amenityId}/availability`, { date }),
      enabled: Boolean(amenityId)
    }))
  });
  const byDay = results.map((r) => r.data);
  const times = byDay.find((d) => d?.open && d.slots.length)?.slots.map((s) => s.time) ?? [];
  const today = todayIso();

  /** Estilo de la celda: las reservas por aprobar se distinguen de las aprobadas */
  const styleOf = (s: Slot | undefined, dayOpen: boolean) => {
    if (!dayOpen || !s) return SLOT_STYLE.closed;
    if (s.bookings?.some((b) => b.status === "pending") && !s.bookings.some((b) => b.status === "approved")) return SLOT_STYLE.pending;
    if (s.bookings?.length && s.status !== "holiday" && s.status !== "unavailable") return SLOT_STYLE.reserved;
    return SLOT_STYLE[s.status] ?? SLOT_STYLE.available;
  };

  return (
    <>
      <Group justify="space-between" mb="md" align="end">
        <Group align="end">
          <Select
            label="Área"
            data={active.map((a) => ({ value: a.id, label: a.name }))}
            value={amenityId}
            onChange={setAmenityId}
            w={220}
            allowDeselect={false}
          />
          <Group gap={4}>
            <ActionIcon variant="default" size="lg" aria-label="Semana anterior" onClick={() => setWeek(addDays(week, -7))}>
              <IconChevronLeft size={18} />
            </ActionIcon>
            <Button variant="default" onClick={() => setWeek(mondayOf(today))}>
              Esta semana
            </Button>
            <ActionIcon variant="default" size="lg" aria-label="Semana siguiente" onClick={() => setWeek(addDays(week, 7))}>
              <IconChevronRight size={18} />
            </ActionIcon>
          </Group>
          <Text fw={600}>
            {dayLabel(days[0])} – {dayLabel(days[6])}
          </Text>
        </Group>
        {can("add_new") && (
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating({ amenityId, date: today })}>
            Nueva reserva
          </Button>
        )}
      </Group>

      <Group gap="md" mb="sm">
        {LEGEND.map((k) => (
          <Group key={k} gap={6}>
            <Box w={14} h={14} style={{ background: SLOT_STYLE[k].bg, border: `1px solid ${SLOT_STYLE[k].fg}`, borderRadius: 4 }} />
            <Text size="xs">{SLOT_STYLE[k].label}</Text>
          </Group>
        ))}
        {area && (
          <Text size="xs" c="dimmed">
            {area.mode === "shared" ? `Compartida · ${area.capacity} personas a la vez` : "Exclusiva · un grupo a la vez"} · bloques de {area.slotMinutes} min
          </Text>
        )}
      </Group>

      <Paper withBorder radius="md">
        <ScrollArea>
          <Box style={{ display: "grid", gridTemplateColumns: `64px repeat(7, minmax(120px, 1fr))`, minWidth: 900 }}>
            <Box />
            {days.map((d, i) => (
              <Box key={d} p="xs" style={{ borderLeft: "1px solid var(--mantine-color-gray-3)", background: d === today ? "var(--mantine-color-blue-0)" : undefined }}>
                <Text size="sm" fw={700} tt="capitalize">
                  {dayLabel(d)}
                </Text>
                <Text size="xs" c="dimmed" lineClamp={1}>
                  {byDay[i] && !byDay[i]!.open ? (byDay[i]!.reason ?? "Cerrado") : byDay[i]?.reason ?? (area && !area.weekdays.includes(isoDow(d)) ? "Cerrado" : " ")}
                </Text>
              </Box>
            ))}
            {times.map((time, row) => (
              <Fragment key={time}>
                <Box p={6} style={{ borderTop: "1px solid var(--mantine-color-gray-3)" }}>
                  <Text size="xs" c="dimmed">
                    {time}
                  </Text>
                </Box>
                {days.map((d, i) => {
                  const day = byDay[i];
                  const slot = day?.open ? day.slots.find((s) => s.time === time) : undefined;
                  const st = styleOf(slot, Boolean(day?.open));
                  const prev = day?.open ? day.slots[row - 1] : undefined;
                  const bookings = slot?.bookings ?? [];
                  const free = slot?.status === "available" && can("add_new");
                  return (
                    <Box
                      key={d}
                      style={{
                        borderTop: "1px solid var(--mantine-color-gray-3)",
                        borderLeft: "1px solid var(--mantine-color-gray-3)",
                        background: st.bg,
                        color: st.fg,
                        minHeight: 34,
                        padding: 4
                      }}
                    >
                      {bookings.length > 0 ? (
                        <Group gap={4} wrap="wrap">
                          {bookings.map((b) => {
                            const continues = prev?.bookings?.some((p) => p.id === b.id);
                            return (
                              <UnstyledButton key={b.id} onClick={() => setOpen(b.id)} aria-label={`Reserva de ${b.unitCode}`}>
                                <Badge size="sm" variant={continues ? "outline" : "filled"} color={b.status === "pending" ? "yellow" : "blue"} style={{ cursor: "pointer" }}>
                                  {continues ? "↳" : `${b.unitCode}${slot?.left !== undefined ? ` · ${b.guests}` : ""}`}
                                </Badge>
                              </UnstyledButton>
                            );
                          })}
                          {free && (
                            <Tooltip label={`Reservar · quedan ${slot?.left}`}>
                              <UnstyledButton onClick={() => setCreating({ amenityId, date: d, time })} aria-label={`Reservar ${d} ${time}`}>
                                <IconPlus size={14} />
                              </UnstyledButton>
                            </Tooltip>
                          )}
                        </Group>
                      ) : slot?.status === "holiday" || slot?.status === "unavailable" ? (
                        <Tooltip label={slot.reason}>
                          <Text size="xs" lineClamp={1}>
                            {slot.reason}
                          </Text>
                        </Tooltip>
                      ) : free ? (
                        <UnstyledButton
                          w="100%"
                          h="100%"
                          onClick={() => setCreating({ amenityId, date: d, time })}
                          aria-label={`Reservar ${d} ${time}`}
                          style={{ fontSize: 12, opacity: 0.7 }}
                        >
                          {slot?.left !== undefined ? `${slot.left} libre(s)` : ""}
                        </UnstyledButton>
                      ) : null}
                    </Box>
                  );
                })}
              </Fragment>
            ))}
          </Box>
          {amenityId && times.length === 0 && !results.some((r) => r.isLoading) && (
            <Text c="dimmed" ta="center" py="xl">
              El área no abre esta semana.
            </Text>
          )}
        </ScrollArea>
      </Paper>

      <BookingModal bookingId={open} onClose={() => setOpen(null)} />
      <NewBookingModal defaults={creating} onClose={() => setCreating(null)} />
    </>
  );
}
