-- Proveedores fijos vs. nuevos/a presupuestar (pedido explícito): la tabla
-- proveedores era muy básica (nombre, contacto, rubro, notas) porque hasta
-- ahora un proveedor solo se creaba "al vuelo" al cargar un presupuesto de
-- compra. Esto agrega los datos de ficha completa que pidió el usuario y,
-- lo más importante, un estado para poder separar "proveedores habituales"
-- de "nuevos / en evaluación" sin tocar ni un dato de los que ya existen —
-- todo columna nueva, todo opcional o con default, cero filas afectadas.
--
-- No se toca ni se renombra la columna "contacto" existente (texto libre
-- que ya se usa en producción) — las columnas nuevas (telefono, email,
-- direccion, persona_contacto) son más específicas y conviven con ella; el
-- proveedor viejo que sólo tiene "contacto" cargado lo sigue mostrando igual.

ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS rut TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS telefono TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS direccion TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS persona_contacto TEXT;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'empresa'; -- empresa | persona_fisica
-- habitual: proveedor de uso frecuente ya probado; nuevo: recién cargado, sin evaluar
-- todavía; en_evaluacion: se le pidió presupuesto y se está considerando; inactivo:
-- ya no se usa pero se conserva el historial de compras.
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'nuevo'; -- nuevo | habitual | en_evaluacion | inactivo
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS creado_por_id INTEGER REFERENCES users(id);
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_proveedores_estado ON proveedores (organization_id, estado);

INSERT INTO schema_migrations (filename) VALUES ('0018_proveedores_extendido.sql') ON CONFLICT (filename) DO NOTHING;
