# tiempos_web

Dashboard de tiempos de formalización (Instacredit). Migración de Power BI a web.

## Estructura

- `app/`: frontend React 19 + Vite + TypeScript, con Supabase como backend (`@supabase/supabase-js`).
- `supabase/migrations/`: migraciones SQL numeradas (`0001_...` a `0023_...`).
- `supabase/seed/`: datos de arranque y sintéticos (super admin, datos de prueba, corrección de id DWH).
- `worker/`: carga desde el DWH a Supabase (`actualizar_tiempos.py`, SQL en `worker/sql/`).
- `scripts/`: utilidades del repo.

## Comandos (desde `app/`)

- `npm run dev`: servidor de desarrollo (Vite).
- `npm run build`: `tsc -b && vite build`.
- `npm run lint`: oxlint.
- `npm run preview`: sirve el build.

## Migraciones

- Aplicar en orden numérico, sin saltar números. Las seeds van después de las migraciones que necesitan.
- Opciones: psycopg contra la base, o pegar el SQL en el SQL editor de Supabase.
- Claude no aplica migraciones ni seeds contra la base. Solo las escribe o revisa, y el usuario las ejecuta.

## Worker

- `python worker/actualizar_tiempos.py`: carga real a Supabase.
- `python worker/actualizar_tiempos.py --simular`: trae del DWH y muestra conteos, sin escribir en Supabase. Usarlo para validar antes de una carga real.
- Tarea programada: `worker/actualizar_tiempos.bat` a las 08:05. Escribe en `worker/actualizar_tiempos.log`.
- Credenciales del worker: en su archivo de configuración local, nunca en el repo.

## Reglas de negocio

Fuente de verdad: `C:\Users\jctorresp\Videos\boveda_tiempos\05_Reglas_de_negocio.md`. Si una regla cambia, se actualiza ahí primero. Resumen de las más sensibles:

- Horas hábiles: L–V 8:00 a 17:00 (9 HH). Sábado y domingo no cuentan. Asuetos según la tabla `asueto`.
- SLA: 24 HH hábiles.
- Prueba: se excluye lo que contenga "PRUEBA", salvo en la sección DAC.
- Promedios (no medianas) en Equipo y DAC.
- Horas menores a 1 HH se muestran en minutos.

## Seguridad

- RLS activo en todas las tablas. Nueva tabla = RLS en la misma migración.
- Funciones `security definer` internas: `revoke execute` a `anon` y `authenticated`.
- Nunca credenciales, claves, tokens ni `.env` en el repo. No leer ni mostrar archivos `.env`, credenciales o contraseñas.
- Push a remoto solo con autorización explícita del usuario. Commits locales sí son parte del flujo normal, pero no se hacen sin pedirlos.

## Forma de trabajar

- El usuario prefiere resultados concretos y cifras validadas. Antes de dar un número, verificarlo contra el DWH o la base, y decir de dónde sale.
- Respuestas directas, en español, con "vos" cuando hablemos con el usuario.
- Si algo no se pudo validar, decirlo en vez de estimarlo.
