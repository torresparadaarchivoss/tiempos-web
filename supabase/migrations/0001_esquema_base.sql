-- 0001_esquema_base.sql
-- Esquema regional de tiempos de formalización (Postgres / Supabase).
-- Un solo esquema sirve a dos fuentes: datos sintéticos (demo, hoy) y el DWH (producción, después).
-- La conexión al DWH NO está en esta migración: la carga se agrega al pasar a producción.
-- Principio: todo dato operativo lleva id_pais y la seguridad la decide RLS por país.

-- ============================================================
-- 1. Catálogos
-- ============================================================
create table public.pais (
    id_pais        smallint    constraint pk_pais primary key,
    codigo         char(2)     constraint uq_pais_codigo unique not null,
    nombre         text        not null,
    moneda         char(3)     not null,
    zona_horaria   text        not null,
    id_pais_dwh    integer     constraint uq_pais_dwh unique,   -- id_pais en el DWH; NULL hasta confirmarlo
    creado_en      timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    constraint ck_pais_codigo check (codigo = upper(codigo))
);

insert into public.pais (id_pais, codigo, nombre, moneda, zona_horaria, id_pais_dwh) values
    (1, 'CR', 'Costa Rica',  'CRC', 'America/Costa_Rica', 4),
    (2, 'PA', 'Panamá',      'USD', 'America/Panama',     null),
    (3, 'NI', 'Nicaragua',   'NIO', 'America/Managua',    null),
    (4, 'SV', 'El Salvador', 'USD', 'America/El_Salvador', null);

-- Asuetos por país (reemplaza la lista fija del SQL y de core/config.py)
create table public.asueto (
    id_pais        smallint    not null constraint fk_asueto_pais references public.pais(id_pais),
    fecha          date        not null,
    descripcion    text,
    creado_en      timestamptz not null default now(),
    constraint pk_asueto primary key (id_pais, fecha)
);

-- Parámetros por país (SLA, estado de corte, roles DAC, etc.)
create table public.parametro_pais (
    id_pais        smallint    not null constraint fk_parametro_pais references public.pais(id_pais),
    clave          text        not null,
    valor          text        not null,
    actualizado_en timestamptz not null default now(),
    constraint pk_parametro_pais primary key (id_pais, clave)
);

-- ============================================================
-- 2. Usuarios y accesos
-- ============================================================
-- perfil: una fila por persona autenticada (auth.users lo administra Supabase Auth)
create table public.perfil (
    user_id        uuid        constraint pk_perfil primary key
                               references auth.users(id) on delete cascade,
    nombre         text        not null,
    es_admin       boolean     not null default false,   -- administrador regional (todos los países)
    activo         boolean     not null default true,
    creado_en      timestamptz not null default now(),
    actualizado_en timestamptz not null default now()
);

-- acceso_pais: en qué países puede entrar cada persona y con qué rol
create table public.acceso_pais (
    user_id        uuid        not null constraint fk_acceso_usuario references public.perfil(user_id) on delete cascade,
    id_pais        smallint    not null constraint fk_acceso_pais references public.pais(id_pais),
    es_admin_pais  boolean     not null default false,   -- administra parámetros de ESTE país
    creado_en      timestamptz not null default now(),
    constraint pk_acceso_pais primary key (user_id, id_pais)
);

-- ============================================================
-- 3. Clasificación de usuarios operativos (equivale a la página Parámetros)
-- ============================================================
create table public.usuario_operativo (
    id_pais        smallint    not null constraint fk_usuop_pais references public.pais(id_pais),
    usuario        text        not null,                 -- nombre tal como aparece en el DWH
    canal          text,
    rol            text        constraint ck_usuop_rol check (rol in ('ANALISTA','DAC','JEFATURA DAC','JEFATURA','OTRO')),
    activo         boolean     not null default true,
    creado_en      timestamptz not null default now(),
    actualizado_en timestamptz not null default now(),
    constraint pk_usuario_operativo primary key (id_pais, usuario)
);

-- ============================================================
-- 4. Hechos (mismas columnas que las consultas de Streamlit)
-- ============================================================
create table public.solicitud (
    id_pais                          smallint    not null constraint fk_solicitud_pais references public.pais(id_pais),
    solicitud                        bigint      not null,
    cliente                          text,
    tipo_solicitud                   text,
    promotor                         text,
    sucursal                         text,
    etapa_bitacora                   text,
    registros_bitacora               integer,
    fecha_creacion                   timestamp,
    creacion_posterior_a_primer_mov  smallint    check (creacion_posterior_a_primer_mov in (0,1)),
    fecha_primer_mov                 timestamp,
    fecha_ultimo_mov                 timestamp,
    fecha_fin_ciclo                  timestamp,
    estado_final                     text,
    resultado_final                  text        check (resultado_final in
                                                 ('EXITOSA','RECHAZADA','DESERCION','ABIERTA','SOLO_UN_ESTADO','ESTANCADA','EN_PROCESO')),
    es_abierta                       smallint    check (es_abierta in (0,1)),
    dias_sin_movimiento              integer,
    registros_solicitud              integer,
    estados_visitados                integer,
    estados_repetidos                integer,
    leadtime_horas                   numeric(17,6),
    leadtime_habil_horas             numeric(17,6),
    leadtime_habil_formalizado       numeric(17,6),
    fecha_aprob_informa              timestamp,
    usuario_crea                     text,
    solicitudes_cliente              integer,
    cliente_reprocesado              smallint    check (cliente_reprocesado in (0,1)),
    cargado_en                       timestamptz not null default now(),
    constraint pk_solicitud primary key (id_pais, solicitud)
);
create index ix_solicitud_pais_fecha on public.solicitud (id_pais, fecha_creacion);

create table public.ciclo_estado (
    id_pais               smallint    not null constraint fk_ciclo_pais references public.pais(id_pais),
    solicitud             bigint      not null,
    id_movimiento         bigint      not null,
    orden_estado          integer     not null check (orden_estado >= 1),
    id_estado             integer,
    estado                text        not null,
    id_estado_destino     integer,
    estado_destino        text,
    clase_estado          text        not null check (clase_estado in ('EXITOSA','RECHAZADA','DESERCION','ABIERTA')),
    fecha_hora            timestamp   not null,
    fecha_salida          timestamp,
    fecha_fin_efectiva    timestamp,
    id_usuario_modifica   integer,
    usuario_modifica      text,
    antes_formalizado     smallint    not null check (antes_formalizado in (0,1)),
    post_corte            smallint    not null check (post_corte in (0,1)),
    horas_habiles         numeric(17,6),
    horas_estado          numeric(17,6),
    cargado_en            timestamptz not null default now(),
    constraint pk_ciclo_estado primary key (id_pais, solicitud, id_movimiento),
    constraint ck_ciclo_fechas check (fecha_salida is null or fecha_salida >= fecha_hora)
);
create index ix_ciclo_estado_pais_fecha on public.ciclo_estado (id_pais, fecha_hora);

-- ============================================================
-- 5. Seguridad: RLS por país
-- ============================================================
-- Funciones SECURITY DEFINER (patrón de la guía). Evitan recursión en las políticas.
create or replace function public.es_super_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select es_admin from public.perfil where user_id = auth.uid() and activo), false) $$;

create or replace function public.paises_del_usuario()
returns setof smallint language sql stable security definer set search_path = public
as $$ select p.id_pais from public.acceso_pais p join public.perfil f on f.user_id = p.user_id
      where p.user_id = auth.uid() and f.activo $$;

create or replace function public.es_admin_de_pais(p smallint)
returns boolean language sql stable security definer set search_path = public
as $$ select public.es_super_admin() or exists (
        select 1 from public.acceso_pais a join public.perfil f on f.user_id = a.user_id
        where a.user_id = auth.uid() and a.id_pais = p and a.es_admin_pais and f.activo) $$;

alter table public.pais             enable row level security;
alter table public.asueto           enable row level security;
alter table public.parametro_pais   enable row level security;
alter table public.perfil           enable row level security;
alter table public.acceso_pais      enable row level security;
alter table public.usuario_operativo enable row level security;
alter table public.solicitud        enable row level security;
alter table public.ciclo_estado     enable row level security;

-- Lectura: cada persona ve solo sus países
create policy pais_lectura on public.pais for select to authenticated
    using (id_pais in (select public.paises_del_usuario()));
create policy asueto_lectura on public.asueto for select to authenticated
    using (id_pais in (select public.paises_del_usuario()));
create policy parametro_lectura on public.parametro_pais for select to authenticated
    using (id_pais in (select public.paises_del_usuario()));
create policy usuario_operativo_lectura on public.usuario_operativo for select to authenticated
    using (id_pais in (select public.paises_del_usuario()));
create policy solicitud_lectura on public.solicitud for select to authenticated
    using (id_pais in (select public.paises_del_usuario()));
create policy ciclo_estado_lectura on public.ciclo_estado for select to authenticated
    using (id_pais in (select public.paises_del_usuario()));

-- Perfil: cada quien ve el suyo; solo el super admin lo modifica
create policy perfil_lectura on public.perfil for select to authenticated
    using (user_id = auth.uid() or public.es_super_admin());
create policy perfil_escritura_admin on public.perfil for all to authenticated
    using (public.es_super_admin()) with check (public.es_super_admin());

-- Accesos por país: solo el super admin asigna países (evita autoasignarse accesos)
create policy acceso_lectura on public.acceso_pais for select to authenticated
    using (user_id = auth.uid() or public.es_super_admin());
create policy acceso_escritura_admin on public.acceso_pais for all to authenticated
    using (public.es_super_admin()) with check (public.es_super_admin());

-- Parámetros por país: los administra el admin de ese país (o el super admin)
create policy asueto_escritura on public.asueto for all to authenticated
    using (public.es_admin_de_pais(id_pais)) with check (public.es_admin_de_pais(id_pais));
create policy parametro_escritura on public.parametro_pais for all to authenticated
    using (public.es_admin_de_pais(id_pais)) with check (public.es_admin_de_pais(id_pais));
create policy usuario_operativo_escritura on public.usuario_operativo for all to authenticated
    using (public.es_admin_de_pais(id_pais)) with check (public.es_admin_de_pais(id_pais));

-- solicitud y ciclo_estado: sin políticas de escritura para usuarios.
-- Solo la carga (service role, o el proceso de sincronización) las escribe.
-- Sin políticas de INSERT/UPDATE/DELETE, RLS las bloquea para cualquier usuario autenticado.

-- Ningún rol anónimo lee nada.
revoke all on all tables in schema public from anon;
