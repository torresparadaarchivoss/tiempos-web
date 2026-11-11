-- 0017_rendimiento.sql
-- Costa Rica, Nicaragua y Panamá superan el límite de 8 s del plan gratuito.
-- 1) Índice para filtrar solicitudes por país y fecha (el periodo).
-- 2) Más tiempo de ejecución solo para las funciones de cálculo (no para el resto de la app).
-- Los índices suman poco espacio (~10 MB); el total seguirá por debajo de 500 MB.

create index if not exists ix_solicitud_pais_fecha on public.solicitud (id_pais, fecha_creacion);
create index if not exists ix_solicitud_pais_usuario on public.solicitud (id_pais, usuario_crea);
analyze public.solicitud;
analyze public.ciclo_estado;

alter function public.cuellos(smallint, date, date, text[], text[], text[]) set statement_timeout = '90s';
alter function public.insights(smallint, date, date, text[], text[], text[], text, numeric) set statement_timeout = '90s';
alter function public.insights_cuartiles(smallint, date, date, text[], text[], text[]) set statement_timeout = '90s';
alter function public.abiertas(smallint, date, date, text[], text[], boolean, numeric) set statement_timeout = '90s';
alter function public.abiertas_graficos(smallint, date, date, text[], text[], boolean) set statement_timeout = '90s';
alter function public.consulta(smallint, bigint, text[]) set statement_timeout = '90s';
alter function public.equipo(smallint, date, date, text[], text[], text[], text[], text[], text, boolean, text, text[]) set statement_timeout = '90s';
