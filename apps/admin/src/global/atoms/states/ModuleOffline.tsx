/**
 * @project DomusApp - Admin
 * @file src/global/atoms/states/ModuleOffline.tsx
 * @description Pantalla de un módulo aún no habilitado (fase futura o mantenimiento)
 */

import { Button, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconTool } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";

interface Props {
  moduleName: string;
  phase?: number;
  backTo?: string;
}

export default function ModuleOffline({ moduleName, phase, backTo = "/dashboard" }: Readonly<Props>) {
  const navigate = useNavigate();
  return (
    <div className="flex items-center justify-center p-10 min-h-[60vh]">
      <Stack align="center" gap="md" className="max-w-md text-center">
        <ThemeIcon size={72} radius="xl" variant="light" color="domus">
          <IconTool size={38} stroke={1.5} />
        </ThemeIcon>
        <Title order={3}>{moduleName} estará disponible pronto</Title>
        <Text c="dimmed" size="sm">
          {phase
            ? `Este módulo se habilita en la fase ${phase} del proyecto.`
            : "El módulo está en mantenimiento. Intente más tarde o consulte al administrador."}
        </Text>
        <Button variant="light" onClick={() => navigate(backTo)}>
          Volver al tablero
        </Button>
      </Stack>
    </div>
  );
}
