/**
 * @project DomusApp - Admin
 * @file src/global/atoms/layouts/ModuleHeader.tsx
 * @description Encabezado de módulo: logo + título + descripción + acciones a la derecha
 */

import type { ReactNode } from "react";
import { LogoMark } from "@atoms/brand/Logo";

interface ModuleHeaderProps {
  title: string;
  description: string;
  right?: ReactNode;
}

export default function ModuleHeader({ title, description, right }: Readonly<ModuleHeaderProps>) {
  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
      <div className="flex items-center gap-3">
        <LogoMark size={52} />
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900 uppercase">{title}</h1>
          <p className="text-gray-500 text-sm">{description}</p>
        </div>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </header>
  );
}
