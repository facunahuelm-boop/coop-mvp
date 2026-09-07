# Fase 04 — Cerrar el hallazgo crítico de RLS (BYPASSRLS)

## Qué pasaba

El audit original encontró que la app se conecta a Postgres con el rol
`postgres`, y ese rol tiene `BYPASSRLS = true`. Las políticas de Row-Level
Security de `migrations/0003_rls_policies.sql` existen y están bien escritas
(`organization_id = current_setting('app.current_org_id')` en cada tabla),
pero para una conexión con `BYPASSRLS` esas políticas quedan completamente
inertes — Postgres ni siquiera las evalúa. En la práctica, el único
aislamiento real entre cooperativas era el filtro `WHERE organization_id = ?`
que agrega `src/lib/db.ts` en cada query. Si algún query puntual se olvidara
ese filtro, no había ninguna red de contención en la base de datos.

## Lo que encontré al investigar (buenas noticias)

Ya existe un rol `app_user` en la base — se creó en algún momento anterior de
este proyecto, y las migraciones 0004/0006/0007 ya le hacen `GRANT` (por eso
esos `GRANT ... TO app_user` nunca fallaron). Verifiqué en vivo, con
consultas de sólo lectura contra `pg_roles` / `information_schema`:

- `app_user`: `rolsuper = false`, `rolbypassrls = false`, `rolcanlogin = true`
  — exactamente lo que se necesita.
- De las 40 tablas en `public`, las 38 tablas de cooperativas tienen RLS
  habilitado **y** `app_user` ya tiene SELECT/INSERT/UPDATE/DELETE en todas.
  Las únicas 2 sin RLS son `organizations` (la tabla raíz de cooperativas,
  que intencionalmente no tiene `organization_id` — el código ya la trata
  aparte con `withRootClient()` en `db.ts`) y `schema_migrations`
  (bookkeeping de migraciones, sin datos de cooperativas).
- `app_user` ya tiene `USAGE` sobre el schema `public` y grants sobre las 38
  secuencias.

Es decir: **no hace falta crear ningún rol ni agregar ningún GRANT.** Lo único
que falta es (a) una contraseña conocida para `app_user` y (b) que la app en
producción se conecte con ese rol en vez de `postgres`.

También confirmé que `scripts/run-migrations.mjs` (el que corre
`npm run migrate`) lee `DATABASE_URL` de tu `.env.local` local — nunca se
ejecuta automáticamente en el deploy de Vercel. Por eso el cambio de abajo no
toca ni `DATABASE_URL` ni `POSTGRES_URL`: le agregué a `src/lib/db.ts` una
variable nueva, `APP_DATABASE_URL`, que la app prioriza si existe, sin tocar
las que ya usan la integración Supabase↔Vercel y tus migraciones locales.

## Por qué no lo hice yo directamente

Crear/alterar roles de base de datos, resetear contraseñas y cambiar
variables de entorno en Vercel son acciones de seguridad/credenciales — las
tenés que ejecutar vos. Yo ya dejé listo el código (`APP_DATABASE_URL` en
`db.ts`) y este instructivo con todo lo que hay que correr.

## Paso 1 — Poner (o resetear) la contraseña de `app_user`

En el SQL Editor de Supabase (`Database` → o el ícono de SQL Editor),
corré esto reemplazando `TU_PASSWORD_NUEVA` por una contraseña fuerte y
nueva (podés generarla con `openssl rand -base64 24` o similar):

```sql
ALTER ROLE app_user WITH PASSWORD 'TU_PASSWORD_NUEVA';
```

Guardá esa contraseña en tu gestor de contraseñas — no queda visible en
ningún lado después de esto.

(Alternativa sin escribir SQL a mano: en el dashboard de Supabase,
`Database` → `Roles` → `app_user` → tiene una opción para resetear la
contraseña desde la interfaz.)

## Paso 2 — Armar el connection string de `app_user`

1. En Vercel: `Settings` → `Environment Variables` → abrí `POSTGRES_URL`
   (o `POSTGRES_URL_NON_POOLING`, la que uses) y copiá su valor. Tiene esta
   forma:
   ```
   postgres://postgres.xxxxxxxxxxxx:CONTRASEÑA_VIEJA@aws-0-xxxx.pooler.supabase.com:6543/postgres
   ```
2. Armá el nuevo string reemplazando sólo el usuario y la contraseña:
   - Si el usuario actual es `postgres.xxxxxxxxxxxx` (modo pooler), el
     nuevo usuario es `app_user.xxxxxxxxxxxx` (mismo sufijo, cambiando sólo
     `postgres` por `app_user`).
   - Si el usuario actual es simplemente `postgres` (conexión directa), el
     nuevo usuario es simplemente `app_user`.
   - Reemplazá la contraseña por la que pusiste en el Paso 1.
   - Dejá igual el host, puerto y `/postgres` del final.

   Ejemplo (pooler):
   ```
   postgres://app_user.xxxxxxxxxxxx:TU_PASSWORD_NUEVA@aws-0-xxxx.pooler.supabase.com:6543/postgres
   ```

## Paso 3 — Cargar `APP_DATABASE_URL` en Vercel

En Vercel: `Settings` → `Environment Variables` → `Add Environment Variable`.

- Nombre: `APP_DATABASE_URL`
- Valor: el connection string armado en el Paso 2
- Entornos: marcá al menos `Production`. Si usás Preview contra la misma
  base, marcalo también.

Guardá y hacé un **redeploy** (Vercel no aplica variables nuevas a
deployments ya existentes).

## Paso 4 — Verificar

Después del redeploy:

- Navegá la app normalmente (login, ver una obra, un socio, etc.) — si algo
  quedó mal armado en el connection string, vas a ver errores de conexión o
  "permission denied" en los logs de la función (Vercel → Deployments →
  Functions → logs), no una pantalla en blanco silenciosa.
- Como chequeo extra, en el SQL Editor de Supabase podés confirmar que la
  conexión activa de la app ya no es `postgres`:
  ```sql
  SELECT usename, count(*) FROM pg_stat_activity
  WHERE datname = 'postgres' GROUP BY usename;
  ```
  Deberías ver `app_user` con conexiones activas (las del pool de Vercel) en
  vez de (o adicional a) `postgres`.

## Qué NO toqué

- `DATABASE_URL` / `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` en Vercel:
  siguen apuntando a `postgres`. Es intencional — evita que un resync futuro
  de la integración Supabase↔Vercel pise el fix, y mantiene
  `npm run migrate` (que sí necesita permisos de DDL) funcionando igual que
  siempre con tu `.env.local`.
- No creé ningún rol nuevo ni cambié ningún `GRANT` — `app_user` ya estaba
  correctamente configurado de una sesión anterior.
