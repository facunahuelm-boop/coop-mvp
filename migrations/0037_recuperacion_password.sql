-- Fase 4 ("Seguridad y permisos granulares(16) + Seguridad de cuentas/2FA/
-- sesiones(17) + Eliminación segura(18)") — Sub-fase 4.3: Recuperación de
-- contraseña por email (último problema real de la sección 17, después de
-- 4.1 y 4.2).
--
-- Hallazgo de la auditoría: no existía ningún flujo de autoservicio para
-- quien olvida su contraseña — la única vía era pedirle a un admin que la
-- restableciera a mano (Sub-fase 4.1, restablecerPasswordUsuarioAction),
-- que sigue existiendo tal cual para cuando de verdad no llega el email.
--
-- Se guarda el HASH del token (sha256, nunca el token en texto plano —
-- mismo criterio que password_hash con bcrypt), de un solo uso y con
-- vencimiento: una eventual fuga de esta tabla no equivale a tener un link
-- de recuperación activo de nadie. reset_solicitado_en es para el
-- throttle anti-abuso (no generar/reenviar un token nuevo si se pidió uno
-- hace menos de unos minutos) — separado de reset_token_expira_en porque
-- uno controla cuánto dura el LINK y el otro cuán seguido se puede PEDIR
-- uno nuevo.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expira_en TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_solicitado_en TIMESTAMPTZ;
