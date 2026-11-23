-- 0023_rls_stg.sql
-- Las tablas de paso stg_* (0018) quedaron sin RLS. Son solo de carga: se bloquea todo acceso
-- desde la API (anon / authenticated). El worker entra como dueño de la tabla y no se ve afectado.

alter table public.stg_solicitud        enable row level security;
alter table public.stg_ciclo_estado     enable row level security;
alter table public.stg_estado_catalogo  enable row level security;
alter table public.stg_usuario_real     enable row level security;

revoke all on public.stg_solicitud, public.stg_ciclo_estado,
              public.stg_estado_catalogo, public.stg_usuario_real
    from anon, authenticated;
