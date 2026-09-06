-- Fase de aislamiento de archivos — reemplaza public/uploads (disco local,
-- efímero en las funciones serverless de Vercel) por Supabase Storage.
--
-- Un solo bucket "uploads", público en lectura (mismo nivel de exposición
-- que tenían los archivos en /public/uploads: la UI arma <img src="...">
-- directo con la URL guardada en la base, sin pasar por una sesión de
-- Supabase). El aislamiento entre cooperativas se hace por convención de
-- carpeta dentro del bucket (<organization_id>/<obra|seguridad|documentos|marca>/...),
-- ver src/lib/upload.ts — todas las subidas pasan por el servidor con la
-- Service Role Key, nunca desde el navegador, así que no hace falta una
-- política de Row-Level Security sobre storage.objects para poder escribir.

INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO NOTHING;
