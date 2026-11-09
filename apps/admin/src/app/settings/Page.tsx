/**
 * @project DomusApp - Admin
 * @file src/app/settings/Page.tsx
 * @description Configuración del condominio activo: identidad, país, moneda, zona horaria y contacto
 */

import { useEffect, useState } from "react";
import { Button, Group, Paper, Skeleton, Stack } from "@mantine/core";
import { IconDeviceFloppy } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPut, refreshSession } from "@clients/apiClient";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import CondominiumFields, { condominiumIsValid, toCondominiumForm, type CondominiumForm } from "@/app/condominiums/CondominiumFields";
import { useCan } from "@modules/access-control/useCan";
import { notifyError, notifySuccess } from "@utils/notify";
import LogoCard from "./LogoCard";

export default function SettingsPage() {
  const qc = useQueryClient();
  const can = useCan("SETTINGS");
  const current = useQuery({
    queryKey: ["settings", "condominium"],
    queryFn: () => apiGet<Record<keyof CondominiumForm, string | null> & { logo: { header: string; square: string } | null }>("/settings/condominium")
  });
  const [form, setForm] = useState<CondominiumForm | null>(null);

  useEffect(() => {
    if (current.data) setForm(toCondominiumForm(current.data));
  }, [current.data]);

  const save = useMutation({
    mutationFn: (f: CondominiumForm) => apiPut("/settings/condominium", f),
    onSuccess: async () => {
      notifySuccess("Configuración guardada");
      // Nombre, país o moneda cambian lo que muestra la cabecera: se trae la sesión fresca
      await refreshSession().catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (err) => notifyError(err)
  });

  const editable = can("edit");

  return (
    <div className="p-6">
      <ModuleHeader title="Configuración" description="Datos del condominio: logo, país, moneda, zona horaria y contacto" />
      {current.data && <LogoCard logo={current.data.logo} editable={can("edit")} />}
      <Paper withBorder radius="lg" p="xl" maw={960}>
        {!form ? (
          <Stack>
            <Skeleton h={36} />
            <Skeleton h={36} />
            <Skeleton h={80} />
          </Stack>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (condominiumIsValid(form)) save.mutate(form);
            }}
          >
            <Stack>
              <CondominiumFields value={form} onChange={setForm} disabled={!editable} />
              {editable && (
                <Group justify="flex-end">
                  <Button type="submit" leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending} disabled={!condominiumIsValid(form)}>
                    Guardar cambios
                  </Button>
                </Group>
              )}
            </Stack>
          </form>
        )}
      </Paper>
    </div>
  );
}
