/**
 * @project DomusApp - Admin
 * @file src/global/atoms/layouts/ModulesSidebar.tsx
 * @description Barra lateral de íconos con los módulos de la sesión (los de fases futuras, atenuados)
 */

import { ScrollArea, Tooltip } from "@mantine/core";
import { IconHome } from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import { coreAuth } from "@auth/store/coreAuth";
import { visibleModules } from "@modules/access-control/moduleTree";
import { moduleIcon } from "@navigation/moduleIcons";

const base = "p-2 rounded-xl transition-all duration-200 border";
const active = "bg-brand-50 text-brand-700 border-brand-100";
const idle = "bg-white text-gray-400 border-transparent hover:text-brand-700 hover:bg-brand-50";
const off = "bg-white text-gray-300 border-transparent cursor-not-allowed";

export default function ModulesSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const modules = coreAuth((s) => s.modules);

  return (
    <aside className="w-[60px] h-full min-h-0 bg-white border-r border-gray-100 flex flex-col shadow-sm z-20 shrink-0">
      <ScrollArea className="flex-1 w-full" scrollbarSize={4} type="scroll">
        <nav className="flex flex-col items-center gap-6 py-6 w-full" aria-label="Módulos">
          <Tooltip label="Tablero" position="right">
            <button type="button" aria-label="Tablero" onClick={() => navigate("/dashboard")} className={`${base} ${pathname.startsWith("/dashboard") ? active : idle}`}>
              <IconHome size={24} stroke={1.6} />
            </button>
          </Tooltip>
          {visibleModules(modules).map(({ module: m, enabled }) => {
            const Icon = moduleIcon(m.icon);
            const isActive = pathname === m.path || pathname.startsWith(`${m.path}/`);
            return (
              <Tooltip key={m.code} label={enabled ? m.name : `${m.name} · próximamente (fase ${m.phase})`} position="right">
                <button
                  type="button"
                  aria-label={m.name}
                  aria-disabled={!enabled}
                  onClick={() => enabled && navigate(m.path)}
                  className={`${base} ${!enabled ? off : isActive ? active : idle}`}
                >
                  <Icon size={24} stroke={1.6} />
                </button>
              </Tooltip>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
