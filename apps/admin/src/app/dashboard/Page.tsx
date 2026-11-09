/**
 * @project DomusApp - Admin
 * @file src/app/dashboard/Page.tsx
 * @description Tablero: cifras del condominio activo y accesos a los módulos de la sesión
 */

import { Badge, Button, Paper, SimpleGrid, Skeleton, Text } from "@mantine/core";
import { IconBuildingCommunity, IconHome, IconHomeOff, IconKey, IconShieldCheck, IconUserShield, IconUsers } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "@clients/apiClient";
import { coreAuth } from "@auth/store/coreAuth";
import { visibleModules } from "@modules/access-control/moduleTree";
import { moduleIcon } from "@navigation/moduleIcons";
import { KIND_LABEL } from "@utils/labels";

interface Summary {
  units: number;
  rented: number;
  vacant: number;
  people: number;
  residents: number;
  guards: number;
  admins: number;
}

function Stat({ label, value, icon: Icon, loading }: Readonly<{ label: string; value?: number; icon: ComponentType<{ size?: number }>; loading: boolean }>) {
  return (
    <Paper withBorder radius="lg" p="md" className="flex items-center gap-3">
      <span className="p-2.5 rounded-xl bg-brand-50 text-brand-700">
        <Icon size={22} />
      </span>
      <div>
        {loading ? <Skeleton h={22} w={40} /> : <Text fw={700} size="xl" lh={1.1}>{value ?? 0}</Text>}
        <Text size="xs" c="dimmed">
          {label}
        </Text>
      </div>
    </Paper>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = coreAuth((s) => s.user);
  const condominium = coreAuth((s) => s.condominium);
  const modules = coreAuth((s) => s.modules);

  const summary = useQuery({
    queryKey: ["dashboard", "summary", condominium?.id],
    queryFn: () => apiGet<Summary>("/dashboard/summary"),
    enabled: Boolean(condominium)
  });

  const firstName = user?.names.split(" ")[0] ?? "";
  const cards = visibleModules(modules);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">Hola, {firstName}</h1>
        {condominium ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className="font-semibold text-gray-700">{condominium.name}</span>
            <Badge variant="light">{KIND_LABEL[condominium.kind] ?? condominium.kind}</Badge>
            <Badge variant="light" color="gray">
              {condominium.country.name} · {condominium.currency.code}
            </Badge>
            <Badge variant="light" color="teal">
              {condominium.roleName}
            </Badge>
          </div>
        ) : (
          <Paper withBorder radius="lg" p="lg" className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div>
              <Text fw={600}>Aún no hay condominios activos</Text>
              <Text size="sm" c="dimmed">
                Como administrador de plataforma, registre el primer condominio y designe a su administrador.
              </Text>
            </div>
            <Button leftSection={<IconBuildingCommunity size={16} />} onClick={() => navigate("/condominiums")}>
              Ir a Condominios
            </Button>
          </Paper>
        )}
      </header>

      {condominium && (
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
          <Stat label="Filiales" value={summary.data?.units} icon={IconHome} loading={summary.isLoading} />
          <Stat label="Alquiladas" value={summary.data?.rented} icon={IconKey} loading={summary.isLoading} />
          <Stat label="Desocupadas" value={summary.data?.vacant} icon={IconHomeOff} loading={summary.isLoading} />
          <Stat label="Personas" value={summary.data?.people} icon={IconUsers} loading={summary.isLoading} />
          <Stat label="Residentes con app" value={summary.data?.residents} icon={IconUserShield} loading={summary.isLoading} />
          <Stat label="Guardas" value={summary.data?.guards} icon={IconShieldCheck} loading={summary.isLoading} />
        </SimpleGrid>
      )}

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-4">Módulos</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ module: m, enabled }) => {
            const Icon = moduleIcon(m.icon);
            return (
              <button
                key={m.code}
                type="button"
                disabled={!enabled}
                onClick={() => navigate(m.path)}
                className={`text-left bg-white rounded-xl border border-gray-200 p-5 shadow-sm transition-all ${
                  enabled ? "hover:border-brand-200 hover:shadow-md" : "opacity-60 cursor-not-allowed"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`p-2.5 rounded-xl ${enabled ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-400"}`}>
                    <Icon size={24} stroke={1.6} />
                  </span>
                  {!enabled && (
                    <Badge variant="light" color="gray">
                      Fase {m.phase}
                    </Badge>
                  )}
                </div>
                <h3 className="mt-4 font-bold text-gray-900">{m.name}</h3>
                <p className="mt-1 text-sm text-gray-500">{m.description}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
