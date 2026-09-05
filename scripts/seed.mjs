// Este script quedó retirado en la Fase 0 (fundaciones multi-tenant).
//
// Por qué: hacía TRUNCATE ... CASCADE sobre las 28 tablas antes de sembrar
// datos de ejemplo. Eso era razonable con una sola cooperativa, pero ahora
// borraría de una sola vez los datos de TODAS las cooperativas del sistema
// — visto en la auditoría, sección 3 ("Problemas encontrados"). Además
// duplicaba (casi al byte) la siembra de datos de /api/setup, con el riesgo
// de que las dos copias se desincronizaran con el tiempo.
//
// Reemplazo seguro:
//   1. npm run migrate            (crea la tabla organizations + organization_id + RLS)
//   2. GET /api/setup?key=...            (crea/verifica las tablas base, sin borrar nada)
//   3. GET /api/setup?key=...&seed=demo  (carga los datos de ejemplo, solo si
//                                          la cooperativa UFAMA todavía está vacía)
console.error(
  "scripts/seed.mjs fue retirado: borraba datos de todas las cooperativas (TRUNCATE global).\n" +
    "Usar en su lugar: npm run migrate, y luego /api/setup?key=...&seed=demo."
);
process.exit(1);
