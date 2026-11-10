/**
 * @project DomusApp - Admin
 * @file src/navigation/AppRouter.tsx
 * @description Rutas del panel: /auth/* públicas; el resto exige sesión y permiso por módulo
 *
 * Los módulos de fases futuras no tienen página: el guard muestra "próximamente".
 */

import { lazy, Suspense, type ReactNode } from "react";
import { Center, Loader } from "@mantine/core";
import { Navigate, Route, Routes } from "react-router-dom";
import AuthLayout from "@layouts/AuthLayout";
import DashboardLayout from "@layouts/DashboardLayout";
import SignInPage from "@auth/sign-in/Page";
import OtpVerifyPage from "@auth/otp-verify/Page";
import ChangePasswordPage from "@auth/change-password/Page";
import ForgotPasswordPage from "@auth/forgot-password/Page";
import ResetPasswordPage from "@auth/reset-password/Page";
import DashboardPage from "@dashboard/Page";
import { AuthRoute, ProtectedRoute } from "./ProtectedRoute";
import { ProtectedModuleRoute } from "./ProtectedModuleRoute";
import { useRestoreSession } from "./useRestoreSession";

const CondominiumsPage = lazy(() => import("@/app/condominiums/Page"));
const UnitsPage = lazy(() => import("@/app/units/Page"));
const PeoplePage = lazy(() => import("@/app/people/Page"));
const MembersPage = lazy(() => import("@/app/members/Page"));
const SettingsPage = lazy(() => import("@/app/settings/Page"));
const PasswordPage = lazy(() => import("@/app/account/PasswordPage"));
const AccessPage = lazy(() => import("@/app/access/Page"));
const AlertsPage = lazy(() => import("@/app/alerts/Page"));
const FinancePage = lazy(() => import("@/app/finance/Page"));
const BookingsPage = lazy(() => import("@/app/bookings/Page"));
const AnnouncementsPage = lazy(() => import("@/app/announcements/Page"));

/** Módulos que aún no tienen pantalla: el guard los resuelve como "próximamente" */
const FUTURE = ["CASES", "ASSEMBLIES", "DOCUMENTS", "SUPPLIERS", "INVENTORY", "REPORTS"];

const lazyPage = (node: ReactNode) => (
  <Suspense
    fallback={
      <Center py={80}>
        <Loader />
      </Center>
    }
  >
    {node}
  </Suspense>
);

function guarded(code: string, path: string, node: ReactNode) {
  return (
    <Route key={code} element={<ProtectedModuleRoute moduleCode={code} />}>
      <Route path={`${path}/*`} element={lazyPage(node)} />
    </Route>
  );
}

export default function AppRouter() {
  useRestoreSession();

  return (
    <Routes>
      <Route element={<AuthRoute />}>
        <Route path="/auth" element={<AuthLayout />}>
          <Route path="sign-in" element={<SignInPage />} />
          <Route path="otp-verify" element={<OtpVerifyPage />} />
          <Route path="change-password" element={<ChangePasswordPage />} />
          <Route path="forgot-password" element={<ForgotPasswordPage />} />
          <Route path="reset-password" element={<ResetPasswordPage />} />
          <Route index element={<Navigate to="sign-in" replace />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/account/password" element={lazyPage(<PasswordPage />)} />
          {guarded("CONDOMINIUMS", "/condominiums", <CondominiumsPage />)}
          {guarded("UNITS", "/units", <UnitsPage />)}
          {guarded("PEOPLE", "/people", <PeoplePage />)}
          {guarded("MEMBERS", "/members", <MembersPage />)}
          {guarded("ACCESS", "/access", <AccessPage />)}
          {guarded("ALERTS", "/alerts", <AlertsPage />)}
          {guarded("FINANCE", "/finance", <FinancePage />)}
          {guarded("BOOKINGS", "/bookings", <BookingsPage />)}
          {guarded("MESSAGES", "/announcements", <AnnouncementsPage />)}
          {guarded("SETTINGS", "/settings", <SettingsPage />)}
          {FUTURE.map((code) => (
            <Route key={code} path={`/${code.toLowerCase()}/*`} element={<ProtectedModuleRoute moduleCode={code} />} />
          ))}
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
