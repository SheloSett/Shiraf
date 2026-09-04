import { createRouter } from "@/server/http";
import {
  changePassword,
  forgotPassword,
  login,
  logout,
  me,
  register,
  requestEmailChange,
  resendVerification,
  resetPassword,
  verifyEmail,
  verifyEmailChange,
} from "@/server/controllers/auth.controller";
import { authMiddleware } from "@/server/middleware/auth.middleware";
import { loginLimiter } from "@/server/middleware/loginLimiter";

/**
 * Las rutas de cuentas.
 *
 * Flaco a propósito, como `auth.routes.js` en Ecommerce_mm: dice **quién puede
 * llamar qué** y nada más. Ni un `if`, ni una consulta. Todo lo que hay para
 * leer acá es la columna de middlewares — y eso es justamente lo que se quiere
 * poder auditar de un vistazo.
 */
export const authRouter = createRouter("/api/auth");

// ── Públicas ────────────────────────────────────────────────────────────────
// El limiter va sólo en las dos que prueban una credencial. `register` no lo
// necesita —no adivina nada— y ponérselo molestaría a alguien que se equivoca
// tipeando su propio mail.
authRouter.post("/login", loginLimiter, login);
authRouter.post("/forgot-password", loginLimiter, forgotPassword);
authRouter.post("/register", register);
authRouter.post("/verify-email", verifyEmail);
// El enlace del cambio de mail se abre donde esté la casilla NUEVA —el teléfono,
// casi siempre—, así que no puede pedir sesión: el token es la credencial.
authRouter.post("/verify-email-change", verifyEmailChange);
authRouter.post("/reset-password", resetPassword);

// Sin sesión también funciona: cerrar sesión cuando no hay ninguna es un
// no-op, y pedir 401 para poder desloguearse deja a alguien con una cookie
// vencida sin forma de sacársela.
authRouter.post("/logout", logout);

// ── Con sesión ──────────────────────────────────────────────────────────────
authRouter.get("/me", authMiddleware, me);
authRouter.put("/password", authMiddleware, changePassword);
// Reenviar el mail de confirmación es de la cuenta propia: sin sesión no hay a
// quién reenviárselo. El freno de los cinco minutos está en el controller y no
// acá porque cuenta por cuenta y no por IP — el limitador de arriba no sabe de
// sesiones.
authRouter.post("/resend-verification", authMiddleware, resendVerification);
// Pedir el cambio de mail sí necesita sesión: es sobre la cuenta propia. Lo que
// no la necesita es aplicarlo, que va con el token de arriba.
authRouter.post("/change-email", authMiddleware, requestEmailChange);
