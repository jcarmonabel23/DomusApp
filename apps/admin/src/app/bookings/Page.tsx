/**
 * @project DomusApp - Admin
 * @file src/app/bookings/Page.tsx
 * @description Áreas comunes y reservaciones: indicadores, calendario por hora, reservas, áreas y bloqueos
 */

import { Badge, Paper, SimpleGrid, Tabs, Text } from "@mantine/core";
import { IconBuildingCommunity, IconCalendarEvent, IconCalendarOff, IconList } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet } from "@clients/apiClient";
import { useRealtime } from "@clients/realtime";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import AmenitiesTab from "./AmenitiesTab";
import BlocksTab from "./BlocksTab";
import CalendarTab from "./CalendarTab";
import ListTab from "./ListTab";

interface Summary {
  upcoming: number;
  pending: number;
  today: number;
  blocks: number;
  amenities: number;
}

const TABS = ["calendar", "list", "amenities", "blocks"] as const;

export default function BookingsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { "*": rest } = useParams();
  const tab = TABS.find((t) => rest?.startsWith(t)) ?? "calendar";
  const summary = useQuery({ queryKey: ["bookings", "summary"], queryFn: () => apiGet<Summary>("/bookings/summary") });
  const s = summary.data;

  // Una reserva nueva, aprobada o cancelada (por la app u otro administrador) refresca el módulo
  useRealtime("bookings:update", () => void qc.invalidateQueries({ queryKey: ["bookings"] }));

  const cards: [string, string, string][] = [
    ["Por aprobar", String(s?.pending ?? "—"), s?.pending ? "solicitudes esperando revisión" : "al día"],
    ["Hoy", String(s?.today ?? "—"), "reservas del día"],
    ["Próximas", String(s?.upcoming ?? "—"), "aprobadas por venir"],
    ["Áreas activas", String(s?.amenities ?? "—"), "visibles en la app"],
    ["Bloqueos vigentes", String(s?.blocks ?? "—"), "feriados, cierres y restricciones"]
  ];

  return (
    <div className="p-6">
      <ModuleHeader title="Reservaciones" description="Áreas comunes, reglamentos, horarios, aprobaciones, feriados y restricciones" />

      <SimpleGrid cols={{ base: 2, md: 5 }} mb="lg">
        {cards.map(([label, value, hint]) => (
          <Paper key={label} withBorder radius="lg" p="md">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text fw={700} size="xl">
              {summary.isLoading ? "—" : value}
            </Text>
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Tabs value={tab} onChange={(v) => navigate(`/bookings/${v}`)} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="calendar" leftSection={<IconCalendarEvent size={16} />}>
            Calendario
          </Tabs.Tab>
          <Tabs.Tab
            value="list"
            leftSection={<IconList size={16} />}
            rightSection={s?.pending ? <Badge size="xs" color="yellow" circle>{s.pending}</Badge> : undefined}
          >
            Reservas
          </Tabs.Tab>
          <Tabs.Tab value="amenities" leftSection={<IconBuildingCommunity size={16} />}>
            Áreas
          </Tabs.Tab>
          <Tabs.Tab value="blocks" leftSection={<IconCalendarOff size={16} />}>
            Feriados y restricciones
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="calendar">
          <CalendarTab />
        </Tabs.Panel>
        <Tabs.Panel value="list">
          <ListTab />
        </Tabs.Panel>
        <Tabs.Panel value="amenities">
          <AmenitiesTab />
        </Tabs.Panel>
        <Tabs.Panel value="blocks">
          <BlocksTab />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
