-- Rediseño "Color secundario + Top Bar": la nueva barra superior necesita
-- mostrar la foto de perfil del usuario en todas las pantallas (punto 13-16
-- del pedido: "foto de perfil... reutilizar el avatar almacenado como
-- referencia, no duplicar imágenes"). Antes no existía ningún campo para
-- esto en `users`.
--
-- Guardamos una URL pública simple (mismo patrón que organizations.logo_url,
-- ver migrations/0001_organizations.sql + saveUploadedFile en lib/upload.ts)
-- y NO el patrón de URL firmada/mediada que usan los documentos sensibles
-- (comprobantes, actas): un avatar no es información sensible, y necesita
-- poder cargarse en decenas de lugares a la vez (Top Bar de cada página,
-- listados, comentarios) sin pedir una URL firmada por cada uno.
--
-- Nullable a propósito: la mayoría de los usuarios existentes no van a tener
-- foto todavía. El front debe mostrar un ícono/inicial genérica cuando es
-- NULL (ver EntidadLink.tsx / Nav.tsx).

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;

INSERT INTO schema_migrations (filename) VALUES ('0023_users_avatar.sql') ON CONFLICT (filename) DO NOTHING;
