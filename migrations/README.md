# Migraciones — Fase 0 (fundaciones multi-tenant)

Reemplazan al viejo `/api/setup` destructivo: cada cambio de esquema queda en
un archivo `.sql` versionado y numerado, y `scripts/run-migrations.mjs` lleva
registro (tabla `schema_migrations`) de cuáles ya se aplicaron. Correrlas de
nuevo no repite ni rompe nada.

## Cómo correrlas

```bash
npm run migrate            # aplica las migraciones pendientes
npm run migrate:dry-run    # solo muestra cuáles faltan, sin tocar la base
```

Necesitan `DATABASE_URL` en `.env.local` apuntando a la base real (Supabase).

## Qué hace cada una

1. **0001_organizations.sql** — crea la tabla raíz `organizations` (una fila
   por cooperativa) y da de alta a UFAMA como la primera cooperativa real.
2. **0002_add_organization_id.sql** — agrega `organization_id` a las 28
   tablas existentes, asigna los datos actuales a UFAMA, y lo vuelve
   obligatorio de ahí en más.
3. **0003_rls_policies.sql** — activa Row Level Security en las 28 tablas:
   ninguna fila es visible ni modificable sin una cooperativa activa
   correctamente fijada.

## Importante antes de correrlas contra Supabase

Row-Level Security **no protege nada si el rol con el que se conecta la
aplicación es superusuario o tiene el atributo `BYPASSRLS`** — Postgres
exime automáticamente a esos roles de cualquier política, con o sin `FORCE
ROW LEVEL SECURITY`. Antes de considerar el aislamiento "activo" en
producción, verificar con:

```sql
select rolname, rolsuper, rolbypassrls
from pg_roles
where rolname = current_user;
```

Si el rol de `DATABASE_URL` da `rolsuper = t` o `rolbypassrls = t`, hay que
crear un rol de aplicación sin esos atributos (`NOSUPERUSER NOBYPASSRLS`),
darle los permisos necesarios sobre las tablas, y usar ESE rol en
`DATABASE_URL` — de lo contrario, la capa de RLS queda sin efecto y el único
aislamiento real pasa a ser el filtro a nivel de aplicación.

Esto se probó de punta a punta en una base Postgres local (creación de
cooperativa, alta de datos existentes, aislamiento entre dos cooperativas de
prueba, y rechazo de un insert cruzado) conectando como un rol sin privilegios
de superusuario — el comportamiento fue el esperado en los cinco casos.
