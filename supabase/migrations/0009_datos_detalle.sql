-- 0009_datos_detalle.sql
-- Catálogos y usuarios reales para el detalle por solicitud (periodo: últimos 3 meses).
-- Sin nombres de clientes: la columna solicitud.cliente se deja vacía a propósito.

create table public.estado_catalogo (
    id_pais        smallint    not null constraint fk_estado_cat_pais references public.pais(id_pais),
    id_estado      integer     not null,
    nombre         text        not null,
    constraint pk_estado_catalogo primary key (id_pais, id_estado)
);

create table public.usuario_real (
    id_pais        smallint    not null constraint fk_usuario_real_pais references public.pais(id_pais),
    id_usuario     integer     not null,
    nombre         text        not null,
    constraint pk_usuario_real primary key (id_pais, id_usuario)
);

alter table public.estado_catalogo enable row level security;
alter table public.usuario_real enable row level security;

create policy estado_catalogo_lectura on public.estado_catalogo for select to authenticated
    using (id_pais in (select public.paises_del_usuario()));
create policy usuario_real_lectura on public.usuario_real for select to authenticated
    using (id_pais in (select public.paises_del_usuario()));

-- Índice para filtrar solicitudes por resultado.
-- No se crea índice (id_pais, solicitud) en ciclo_estado: la clave primaria ya lo cubre.
-- Límite del plan gratuito (500 MB): cada índice extra cuenta contra ese espacio.
create index if not exists ix_solicitud_pais_estado on public.solicitud (id_pais, resultado_final);
