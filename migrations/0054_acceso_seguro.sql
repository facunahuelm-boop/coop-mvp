-- 0054 — Fase 1E "Acceso": entrar con un link al email y verificación en
-- dos pasos.
--
--  - Link de acceso por email (para socios): un enlace de un solo uso, que
--    vence a los 15 minutos. Se guarda sólo el hash del token, nunca el token.
--  - Verificación en dos pasos (código de 6 números de una app como Google
--    Authenticator): el secreto se guarda CIFRADO (lib/crypto.ts) y los
--    códigos de respaldo sólo como hash.
--  - "Cerrar sesión en todos los dispositivos": toda sesión emitida antes de
--    sesiones_invalidadas_en deja de valer.
--
-- No destructiva: sólo columnas nuevas, todas opcionales.

ALTER TABLE users ADD COLUMN IF NOT EXISTS acceso_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acceso_token_expira_en TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS acceso_solicitado_en TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secreto TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_activado_en TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_respaldo TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sesiones_invalidadas_en TEXT;
