-- 0020_equipo_dac.sql
-- Sección "Equipo DAC": solo equipo DAC, sin solicitudes de prueba, solicitudes con menos de dos pasos por PENDIENTES.
-- Filtros: país y periodo (por fecha de creación). Las series mensuales usan el año en curso y solo el país.
-- SECURITY INVOKER: aplica RLS del usuario.

-- p_solo_analistas: false = todo lo DAC (p_roles_dac); true = solo analistas (rol ANALISTA)
drop function if exists public.equipo_dac(smallint, date, date, text[]);
create or replace function public.equipo_dac(
    p_pais            smallint,
    p_desde           date,
    p_hasta           date,
    p_roles_dac       text[]  default array['DAC'],
    p_solo_analistas  boolean default false
)
returns json
language sql
stable
security invoker
set statement_timeout = '90s'
as $$
with s as (
    select s.solicitud, s.resultado_final, s.fecha_creacion, s.fecha_fin_ciclo, s.tipo_solicitud
    from public.solicitud s
    where s.id_pais = p_pais
      and s.fecha_creacion::date between p_desde and p_hasta
      and coalesce(s.estado_final, '') not ilike '%PRUEBA%'
      and coalesce(s.tipo_solicitud, '') not ilike '%PRUEBA%'
),
pc as (   -- veces que la solicitud pasó por PENDIENTES en el histórico
    select ce.solicitud, count(*) filter (where upper(ce.estado) like 'PENDIENTE%') as pend_veces
    from public.ciclo_estado ce
    where ce.id_pais = p_pais and ce.solicitud in (select solicitud from s)
    group by ce.solicitud
),
sf as (   -- base del análisis: como máximo un paso por PENDIENTES
    select s.* from s left join pc on pc.solicitud = s.solicitud where coalesce(pc.pend_veces, 0) <= 1
),
ce as (
    select c.solicitud, c.id_movimiento, c.orden_estado, c.estado, c.fecha_hora, c.horas_habiles,
           c.usuario_modifica as usuario, coalesce(u.rol, 'SIN CLASIFICAR') as rol
    from public.ciclo_estado c
    join sf on sf.solicitud = c.solicitud
    left join public.usuario_operativo u on u.id_pais = c.id_pais and u.usuario = c.usuario_modifica
    where c.id_pais = p_pais and c.post_corte = 0
),
dac as (select * from ce where rol = any(case when p_solo_analistas then array['ANALISTA'] else p_roles_dac end) and usuario is not null),
tocadas as (select distinct solicitud from dac),
sd as (   -- solicitudes que sí pasaron por DAC
    select sf.* from sf where sf.solicitud in (select solicitud from tocadas)
),
-- ===== Resultados (lógica del resultado final) =====
resultados as (
    select count(*) as total,
           count(*) filter (where resultado_final = 'EXITOSA') as aprobadas,
           count(*) filter (where resultado_final = 'RECHAZADA') as rechazadas,
           count(*) filter (where resultado_final = 'RECHAZADA' and solicitud in (select solicitud from ce where upper(estado) like '%RECEP%')) as rech_recepcion,
           count(*) filter (where resultado_final = 'DESERCION') as desercion,
           count(*) filter (where resultado_final not in ('EXITOSA', 'RECHAZADA', 'DESERCION')) as en_proceso
    from sd
),
-- ===== Lead time =====
asig as (
    select solicitud, min(fecha_hora) as t_asig from ce where upper(estado) like '%POR ASIGNAR%ANALISTA%' group by solicitud
),
lt as (
    select sd.solicitud,
           extract(epoch from (sd.fecha_fin_ciclo - sd.fecha_creacion)) / 86400.0 as dias_creacion,
           extract(epoch from (sd.fecha_fin_ciclo - a.t_asig)) / 86400.0 as dias_asignacion,
           (select coalesce(sum(c.horas_habiles), 0) from ce c where c.solicitud = sd.solicitud and c.fecha_hora >= a.t_asig) as hh_asignacion
    from sd left join asig a on a.solicitud = sd.solicitud
    where sd.fecha_fin_ciclo is not null
),
lt_resumen as (
    select count(*) as n,
           avg(dias_creacion) as promedio_creacion,
           avg(dias_asignacion) as promedio_asignacion,
           avg(hh_asignacion) as promedio_hh_asignacion
    from lt
),
-- Lead time por persona DAC (horas hábiles de sus estadías)
lt_persona as (
    select usuario, rol, count(*) as estadias, count(distinct solicitud) as solicitudes,
           round(avg(horas_habiles)::numeric, 1) as promedio_hh,
           round(sum(horas_habiles)::numeric, 1) as horas
    from dac group by usuario, rol
),
-- ===== Flujo de ingreso al DAC =====
ingreso as (select solicitud, min(fecha_hora) as t from dac group by solicitud),
flujo_dia as (select extract(day from t)::int as dia, count(*) as n from ingreso group by 1),
flujo_hora as (select extract(hour from t)::int as hora, count(*) as n from ingreso group by 1),
flujo_dia_hora as (select extract(day from t)::int as dia, extract(hour from t)::int as hora, count(*) as n from ingreso group by 1, 2),
-- ===== Productividad y capacidad =====
dias_habiles as (
    select count(*) as n from generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') d
    where extract(isodow from d) < 6 and not exists (select 1 from public.asueto a where a.id_pais = p_pais and a.fecha = d::date)
),
prod_persona as (
    select usuario, rol, count(distinct solicitud) as solicitudes,
           round((count(distinct solicitud)::numeric / greatest((select n from dias_habiles), 1)), 2) as por_dia
    from dac group by usuario, rol
),
max_dia as (
    select usuario, fecha_hora::date as dia, count(distinct solicitud) as n from dac group by 1, 2
),
optimo as (   -- tiempo promedio de horas hábiles por estadía DAC (solicitudes con a lo sumo un paso por PENDIENTES)
    select avg(horas_habiles) as hh from dac where horas_habiles > 0
)
select json_build_object(
  'dias_habiles', (select n from dias_habiles),
  'resultados', (select json_build_object('total', total, 'aprobadas', aprobadas, 'rechazadas', rechazadas,
        'rech_recepcion', rech_recepcion, 'desercion', desercion, 'en_proceso', en_proceso) from resultados),
  'lead_time', (select json_build_object('n', n, 'promedio_creacion_dias', round(promedio_creacion::numeric, 1),
        'promedio_asignacion_dias', round(promedio_asignacion::numeric, 1), 'promedio_hh_asignacion', round(promedio_hh_asignacion::numeric, 1)) from lt_resumen),
  'persona_lt', coalesce((select json_agg(json_build_object('usuario', usuario, 'rol', rol, 'estadias', estadias,
        'solicitudes', solicitudes, 'promedio_hh', promedio_hh, 'horas', horas) order by horas desc) from lt_persona), '[]'::json),
  'flujo_dia', coalesce((select json_agg(json_build_object('dia', dia, 'n', n) order by dia) from flujo_dia), '[]'::json),
  'flujo_hora', coalesce((select json_agg(json_build_object('hora', hora, 'n', n) order by hora) from flujo_hora), '[]'::json),
  'flujo_dia_hora', coalesce((select json_agg(json_build_object('dia', dia, 'hora', hora, 'n', n)) from flujo_dia_hora), '[]'::json),
  'productividad', coalesce((select json_agg(json_build_object('usuario', usuario, 'rol', rol, 'solicitudes', solicitudes,
        'por_dia', por_dia) order by solicitudes desc) from prod_persona), '[]'::json),
  'capacidad', json_build_object(
        'hh_promedio_estadia', (select round(hh::numeric, 2) from optimo),
        'max_teorico_dia', (select round((9 / nullif(hh, 0))::numeric, 1) from optimo),
        'max_observado_dia', (select coalesce(max(n), 0) from max_dia))
);
$$;

grant execute on function public.equipo_dac(smallint, date, date, text[], boolean) to authenticated;
revoke execute on function public.equipo_dac(smallint, date, date, text[], boolean) from anon;

-- Series mensuales del año en curso: solo país (sin periodo, tipo ni canal).
create or replace function public.equipo_dac_mes(p_pais smallint, p_roles_dac text[] default array['DAC'])
returns json
language sql
stable
security invoker
set statement_timeout = '90s'
as $$
with s as (
    select s.solicitud, s.resultado_final, s.fecha_creacion, s.fecha_fin_ciclo
    from public.solicitud s
    where s.id_pais = p_pais
      and s.fecha_creacion >= date_trunc('year', current_date)
      and coalesce(s.estado_final, '') not ilike '%PRUEBA%'
      and coalesce(s.tipo_solicitud, '') not ilike '%PRUEBA%'
),
pc as (
    select ce.solicitud, count(*) filter (where upper(ce.estado) like 'PENDIENTE%') as pend_veces
    from public.ciclo_estado ce where ce.id_pais = p_pais and ce.solicitud in (select solicitud from s) group by ce.solicitud
),
sf as (select s.* from s left join pc on pc.solicitud = s.solicitud where coalesce(pc.pend_veces, 0) <= 1),
dac as (
    select c.solicitud, c.fecha_hora, c.usuario_modifica as usuario
    from public.ciclo_estado c
    join sf on sf.solicitud = c.solicitud
    left join public.usuario_operativo u on u.id_pais = c.id_pais and u.usuario = c.usuario_modifica
    where c.id_pais = p_pais and c.post_corte = 0 and coalesce(u.rol, '') = any(p_roles_dac) and c.usuario_modifica is not null
),
mes_lt as (
    select date_trunc('month', fecha_creacion)::date as mes,
           round(avg(extract(epoch from (fecha_fin_ciclo - fecha_creacion)) / 86400.0)::numeric, 1) as promedio_dias,
           count(*) as n
    from sf where fecha_fin_ciclo is not null group by 1
),
mes_prod as (
    select date_trunc('month', fecha_hora)::date as mes, count(distinct solicitud) as solicitudes,
           count(distinct usuario) as personas
    from dac group by 1
)
select json_build_object(
  'tiempos', coalesce((select json_agg(json_build_object('mes', mes, 'promedio_dias', promedio_dias, 'n', n) order by mes) from mes_lt), '[]'::json),
  'productividad', coalesce((select json_agg(json_build_object('mes', mes, 'solicitudes', solicitudes, 'personas', personas) order by mes) from mes_prod), '[]'::json)
);
$$;

grant execute on function public.equipo_dac_mes(smallint, text[]) to authenticated;
revoke execute on function public.equipo_dac_mes(smallint, text[]) from anon;

notify pgrst, 'reload schema';
