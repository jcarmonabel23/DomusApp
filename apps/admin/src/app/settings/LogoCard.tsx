/**
 * @project DomusApp - Admin
 * @file src/app/settings/LogoCard.tsx
 * @description Logo del condominio: aparece en la cabecera, en la app móvil y en los PDF exportados
 */

import { Button, FileButton, Group, Paper, Text } from "@mantine/core";
import { IconPhoto, IconTrash, IconUpload } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiUpload, refreshSession } from "@clients/apiClient";
import { confirmDelete } from "@utils/confirm";
import { notifyError, notifySuccess } from "@utils/notify";

interface Props {
  logo: { header: string; square: string } | null;
  editable: boolean;
}

const MAX_BYTES = 5 * 1024 * 1024;

export default function LogoCard({ logo, editable }: Readonly<Props>) {
  const qc = useQueryClient();

  const done = async (message: string) => {
    notifySuccess(message);
    // La cabecera lee el logo de la sesión: se pide una nueva con las URLs actualizadas
    await refreshSession().catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["settings"] });
  };

  const upload = useMutation({
    mutationFn: (file: File) => apiUpload("/settings/logo", file),
    onSuccess: () => done("Logo actualizado"),
    onError: (err) => notifyError(err, "No se pudo subir el logo")
  });

  const remove = useMutation({
    mutationFn: () => apiDelete("/settings/logo"),
    onSuccess: () => done("Logo eliminado"),
    onError: (err) => notifyError(err)
  });

  const pick = (file: File | null) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      notifyError(new Error("El archivo pesa más de 5 MB"), "Logo demasiado grande");
      return;
    }
    upload.mutate(file);
  };

  return (
    <Paper withBorder radius="lg" p="xl" maw={960} mb="lg">
      <Group justify="space-between" wrap="nowrap" align="center">
        <Group wrap="nowrap">
          <div className="w-24 h-24 rounded-lg border border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-white shrink-0">
            {logo ? <img src={logo.square} alt="Logo del condominio" className="max-w-full max-h-full object-contain" /> : <IconPhoto size={32} className="text-gray-400" />}
          </div>
          <div>
            <Text fw={600}>Logo del condominio</Text>
            <Text size="sm" c="dimmed">
              Se muestra en la cabecera del panel, en la app de residentes y guardas, y en los reportes PDF.
            </Text>
            <Text size="xs" c="dimmed">
              PNG, JPG o WebP de hasta 5 MB. Mejor con fondo transparente.
            </Text>
          </div>
        </Group>
        {editable && (
          <Group gap="xs" wrap="nowrap">
            <FileButton onChange={pick} accept="image/png,image/jpeg,image/webp">
              {(props) => (
                <Button {...props} variant="light" leftSection={<IconUpload size={16} />} loading={upload.isPending}>
                  {logo ? "Cambiar" : "Subir logo"}
                </Button>
              )}
            </FileButton>
            {logo && (
              <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} loading={remove.isPending} onClick={() => confirmDelete("el logo", () => remove.mutate())}>
                Quitar
              </Button>
            )}
          </Group>
        )}
      </Group>
    </Paper>
  );
}
