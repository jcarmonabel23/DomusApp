/**
 * @project DomusApp - Admin
 * @file src/app/access/Page.tsx
 * @description Control de acceso: resumen, bitácora (con exportación), autorizados y vehículos
 */

import { Paper, SimpleGrid, Tabs, Text } from "@mantine/core";
import { IconCar, IconClipboardList, IconUserCheck } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet } from "@clients/apiClient";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import AuthorizationsTab from "./AuthorizationsTab";
import LogTab from "./LogTab";
import VehiclesTab from "./VehiclesTab";

interface Summary {
  inside: number;
  pending: number;
  entriesToday: number;
  activeAuthorizations: number;
  vehicles: number;
}

const TABS = ["log", "authorizations", "vehicles"] as const;

export default function AccessPage() {
  const navigate = useNavigate();
  const { "*": rest } = useParams();
  const tab = TABS.find((t) => rest?.startsWith(t)) ?? "log";
  const summary = useQuery({ queryKey: ["access", "summary"], queryFn: () => apiGet<Summary>("/access/summary"), refetchInterval: 30_000 });
  const s = summary.data;

  return (
    <div className="p-6">
      <ModuleHeader title="Control de acceso" description="Bitácora de la caseta, autorizados de cada filial y vehículos registrados" />

      <SimpleGrid cols={{ base: 2, md: 5 }} mb="lg">
        {[
          ["Adentro ahora", s?.inside],
          ["Visitas esperando respuesta", s?.pending],
          ["Ingresos hoy", s?.entriesToday],
          ["Autorizados vigentes", s?.activeAuthorizations],
          ["Vehículos registrados", s?.vehicles]
        ].map(([label, value]) => (
          <Paper key={label as string} withBorder radius="lg" p="md">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text fw={700} size="xl">
              {value ?? "—"}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Tabs value={tab} onChange={(v) => navigate(`/access/${v}`)} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="log" leftSection={<IconClipboardList size={16} />}>
            Bitácora
          </Tabs.Tab>
          <Tabs.Tab value="authorizations" leftSection={<IconUserCheck size={16} />}>
            Autorizados
          </Tabs.Tab>
          <Tabs.Tab value="vehicles" leftSection={<IconCar size={16} />}>
            Vehículos
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="log">
          <LogTab />
        </Tabs.Panel>
        <Tabs.Panel value="authorizations">
          <AuthorizationsTab />
        </Tabs.Panel>
        <Tabs.Panel value="vehicles">
          <VehiclesTab />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
