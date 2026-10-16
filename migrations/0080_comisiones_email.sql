-- Mail de cada comisión (16/10, pedido explícito): se muestra en el resumen
-- de la comisión y en el tablero de Comisiones, para que las comisiones sepan
-- a qué dirección escribirse entre ellas. Opcional; se carga al crear o
-- editar la comisión.
ALTER TABLE comisiones ADD COLUMN IF NOT EXISTS email TEXT;
