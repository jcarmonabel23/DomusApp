/**
 * @project DomusApp - Admin
 * @file src/layouts/DashboardLayout.tsx
 * @description Layout autenticado: header + sidebar (salvo en el tablero) + contenido + aviso de inactividad
 */

import { Button, Group, Modal, Text } from "@mantine/core";
import { Outlet, useLocation } from "react-router-dom";
import ModulesSidebar from "@atoms/layouts/ModulesSidebar";
import AppVersion from "@atoms/version/AppVersion";
import { signOut } from "@auth/logout/logout.service";
import { useSessionGuard } from "@modules/session/useSessionGuard";
import HeaderMain from "./components/HeaderMain";

export default function DashboardLayout() {
  const { pathname } = useLocation();
  const showSidebar = pathname !== "/dashboard";
  const { warning, secondsLeft, stayConnected } = useSessionGuard();

  return (
    <div className="h-dvh flex flex-col">
      <HeaderMain />
      <div className="flex flex-1 min-h-0">
        {showSidebar && <ModulesSidebar />}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <AppVersion />

      <Modal opened={warning} onClose={stayConnected} title="¿Sigue ahí?" centered withCloseButton={false}>
        <Text size="sm">
          Por inactividad, su sesión se cerrará en <b>{secondsLeft}</b> segundos.
        </Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => signOut()}>
            Cerrar sesión
          </Button>
          <Button onClick={stayConnected}>Seguir conectado</Button>
        </Group>
      </Modal>
    </div>
  );
}
