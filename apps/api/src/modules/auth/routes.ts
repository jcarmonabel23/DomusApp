/**
 * @project DomusApp - API
 * @file src/modules/auth/routes.ts
 * @description Rutas de autenticación (/api/v1/auth)
 */

import { Router } from "express";
import { authenticate } from "../../security/authenticate.js";
import { authLimiter, refreshLimiter } from "../../security/rateLimits.js";
import { otpResend } from "./otpResend.js";
import { otpVerify } from "./otpVerify.js";
import { forgotPassword, resetPassword } from "./passwordReset.js";
import { refresh } from "./refresh.js";
import { changePassword, logout, logoutAll, me, switchCondominium } from "./session.js";
import { signIn } from "./signIn.js";

export const authRoutes = Router();

// /me y el cambio de contraseña devuelven el condominio vigente: el cliente se sincroniza
const pending = authenticate({ allowPendingPasswordChange: true, ignoreCondominiumHeader: true });
// Cambiar de condominio es justamente lo que provoca CONDOMINIUM_CHANGED: no se valida la cabecera
const session = authenticate({ ignoreCondominiumHeader: true });

authRoutes.post("/sign-in", authLimiter, signIn);
authRoutes.post("/otp/verify", authLimiter, otpVerify);
authRoutes.post("/otp/resend", authLimiter, otpResend);
authRoutes.post("/forgot-password", authLimiter, forgotPassword);
authRoutes.post("/reset-password", authLimiter, resetPassword);

authRoutes.post("/refresh", refreshLimiter, refresh);
authRoutes.post("/logout", logout);
authRoutes.post("/logout-all", pending, logoutAll);

authRoutes.get("/me", pending, me);
authRoutes.post("/change-password", authLimiter, pending, changePassword);
authRoutes.post("/switch-condominium", session, switchCondominium);
