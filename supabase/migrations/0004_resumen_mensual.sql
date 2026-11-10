-- 0004_resumen_mensual.sql
-- Tabla AGREGADA (aprobada por Gerencia Regional de Riesgos): cifras por mes, tipo y resultado.
-- No contiene nombres de personas, clientes, promotores ni números de solicitud.
-- Se alimenta desde el equipo local (proceso de extracción), nunca desde la aplicación web.

create table public.resumen_mensual (
    id_pais                 smallint    not null constraint fk_resumen_pais references public.pais(id_pais),
    mes                     date        not null check (mes = date_trunc('month', mes)::date),
    tipo_solicitud          text        not null,
    resultado_final         text        not null,
    creadas                 integer     not null check (creadas >= 0),
    formalizadas            integer     not null check (formalizadas >= 0 and formalizadas <= creadas),
    suma_hh_formalizado     numeric(18,4) not null default 0,   -- suma de horas hábiles a formalización
    dentro_sla              integer     not null default 0 check (dentro_sla >= 0 and dentro_sla <= formalizadas),
    hasta_8_hh              integer     not null default 0,      -- rangos de horas hábiles (BINS_HH = 8, 16, 24)
    de_8_a_16_hh            integer     not null default 0,
    de_16_a_24_hh           integer     not null default 0,
    mas_de_24_hh            integer     not null default 0,
    actualizado_en          timestamptz not null default now(),
    constraint pk_resumen_mensual primary key (id_pais, mes, tipo_solicitud, resultado_final),
    constraint ck_resumen_bins check (hasta_8_hh + de_8_a_16_hh + de_16_a_24_hh + mas_de_24_hh = formalizadas)
);
create index ix_resumen_mensual_pais_mes on public.resumen_mensual (id_pais, mes);

alter table public.resumen_mensual enable row level security;

-- Lectura: solo de los países asignados (RLS, igual que el resto)
create policy resumen_mensual_lectura on public.resumen_mensual for select to authenticated
    using (id_pais in (select public.paises_del_usuario()));

-- Sin políticas de escritura para usuarios: solo el proceso de carga (service role) escribe aquí.
