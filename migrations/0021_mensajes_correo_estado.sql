-- Auditoría integral del sistema (pedido explícito): "no quiero un botón que
-- simplemente diga 'Email enviado' sin comprobar realmente qué ocurrió".
--
-- Hasta ahora mensajes_correo solo se insertaba DESPUÉS de que el envío ya
-- había salido bien (ver actions/mails.ts) — un envío fallido no dejaba
-- ningún rastro visible en /mails, y los emails automáticos de alertas
-- críticas (lib/email.ts::enviarEmailAlerta) no se registraban nunca, ni
-- siquiera cuando salían bien. Esto agrega:
--
--   - estado: 'enviado' | 'fallido' — nunca "entregado": con SMTP común no
--     hay forma de confirmar que el mensaje llegó a la casilla del
--     destinatario, solo que el servidor lo aceptó para enviarlo. Distinguir
--     "aceptado" de "entregado" evita prometer algo que el sistema no puede
--     verificar (confirmado real vía webhook de un proveedor tipo
--     Resend/SendGrid/SES quedaría documentado como dependencia externa).
--   - error: detalle real cuando estado = 'fallido', para poder mostrarlo en
--     el historial en vez de que el mail simplemente desaparezca.
--   - origen: 'manual' (alguien lo escribió desde /mails) | 'alerta'
--     (disparado automáticamente por el motor de alertas críticas) — antes
--     solo los manuales quedaban en el historial.
--
-- DEFAULT 'enviado' en las filas existentes porque todas las que ya están
-- cargadas corresponden a envíos manuales que sí llegaron a completarse (si
-- hubieran fallado, con el código anterior ni siquiera se habrían insertado).

ALTER TABLE mensajes_correo ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'enviado';
ALTER TABLE mensajes_correo ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE mensajes_correo ADD COLUMN IF NOT EXISTS origen TEXT NOT NULL DEFAULT 'manual';

-- Los emails de alerta automáticos no tienen un remitente humano — antes
-- remitente_id era obligatorio porque hasta ahora solo existían mails
-- escritos a mano por una persona.
ALTER TABLE mensajes_correo ALTER COLUMN remitente_id DROP NOT NULL;

INSERT INTO schema_migrations (filename) VALUES ('0021_mensajes_correo_estado.sql') ON CONFLICT (filename) DO NOTHING;
