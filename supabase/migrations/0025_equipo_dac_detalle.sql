-- 0025_equipo_dac_detalle.sql
-- Equipo DAC, detalle en Productividad por analista:
--   a) Tiempo promedio por analista sin contar estados PENDIENTE (promedio por estadía, HH hábiles).
--   b) Teórico vs actual por analista: solicitudes teóricas = días hábiles × (9 HH ÷ tiempo óptimo) y diferencia.
--   c) Asesores: pendientes generados por solicitud y rechazos (recepción y analista).
-- Reemplaza equipo_dac de 0021 (misma firma). equipo_dac_mes no cambia.
-- Definiciones:
--   Asesor = usuario que mueve la solicitud (cualquier rol). Pendiente generado = movimiento a estado PENDIENTE hecho por él.
--   Rechazo = movimiento con clase RECHAZADA. Recepción = estado que contiene RECEP; el resto es rechazo por analista.
-- SECURITY INVOKER: aplica RLS del usuario.

create or replace function public.equipo_dac(
    p_pais           smallint,
    p_desde          date,
    p_hasta          date,
    p_solo_analistas boolean default false,
    p_asociados      text[]  default array['DAC', 'JEFATURA DAC', 'OTRO'],
    p_pend           text    default 'hasta_uno'
)
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
      and s.fecha_creacion::date between p_desde and p_hasta
      and coalesce(s.estado_final, '') not ilike '%PRUEBA%'
      and coalesce(s.tipo_solicitud, '') not ilike '%PRUEBA%'
),
pc as (   -- veces que cada solicitud pasó por PENDIENTES
    select ce.solicitud, count(*) filter (where upper(ce.estado) like 'PENDIENTE%') as pend_veces
    from public.ciclo_estado ce
    where ce.id_pais = p_pais and ce.solicitud in (select solicitud from s)
    group by ce.solicitud
),
sb as (   -- solicitudes del periodo con su número de pasos por PENDIENTES
    select s.*, coalesce(pc.pend_veces, 0) as pend_veces
    from s left join pc on pc.solicitud = s.solicitud
),
ce_b as (   -- movimientos antes de formalización
    select c.solicitud, c.id_movimiento, c.orden_estado, c.estado, c.clase_estado, c.fecha_hora, c.horas_habiles,
           c.usuario_modifica as usuario, coalesce(u.rol, 'SIN CLASIFICAR') as rol
    from public.ciclo_estado c
    join sb on sb.solicitud = c.solicitud
    left join public.usuario_operativo u on u.id_pais = c.id_pais and u.usuario = c.usuario_modifica
    where c.id_pais = p_pais and c.post_corte = 0 and c.usuario_modifica is not null
),
tocadas_b as (   -- solicitudes que tocó el equipo elegido (antes del filtro de PENDIENTES)
    select distinct solicitud from ce_b
    where rol = any(case when p_solo_analistas then array['DAC'] else p_asociados end)
),
grupos_pend as (   -- desglose por PENDIENTES de las solicitudes que tocó el equipo elegido
    select case when pend_veces = 0 then 'Sin pendientes'
                when pend_veces = 1 then 'Con 1 pendiente'
                else 'Con 2 o más' end as grupo,
           case when pend_veces = 0 then 0 when pend_veces = 1 then 1 else 2 end as orden,
           count(*) as n
    from sb where solicitud in (select solicitud from tocadas_b)
    group by 1, 2
),
sf as (   -- base del análisis según el filtro de PENDIENTES elegido
    select sb.* from sb
    where case p_pend
            when 'todas' then true
            when 'sin' then pend_veces = 0
            when 'una' then pend_veces = 1
            when 'dos_o_mas' then pend_veces >= 2
            else pend_veces <= 1
          end
),
dac as (   -- movimientos del equipo elegido dentro de la base
    select ce_b.* from ce_b
    join sf on sf.solicitud = ce_b.solicitud
    where ce_b.rol = any(case when p_solo_analistas then array['DAC'] else p_asociados end)
),
tocadas as (select distinct solicitud from dac),
sd as (select sf.* from sf where sf.solicitud in (select solicitud from tocadas)),
ce as (select * from ce_b where solicitud in (select solicitud from sd)),
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
lt_persona as (
    select usuario, rol, count(*) as estadias, count(distinct solicitud) as solicitudes,
           round(avg(horas_habiles)::numeric, 1) as promedio_hh,
           round(sum(horas_habiles)::numeric, 1) as horas,
           -- promedio por estadía en todos los estados excepto PENDIENTE (HH hábiles)
           round((avg(horas_habiles) filter (where upper(estado) not like 'PENDIENTE%'))::numeric, 2) as promedio_hh_sin_pend
    from dac group by usuario, rol
),
-- ===== Flujo de ingreso al equipo =====
ingreso as (select solicitud, min(fecha_hora) as t from dac group by solicitud),
flujo_dia as (select extract(day from t)::int as dia, count(*) as n from ingreso group by 1),
flujo_hora as (select extract(hour from t)::int as hora, count(*) as n from ingreso group by 1),
flujo_dia_hora as (select extract(day from t)::int as dia, extract(hour from t)::int as hora, count(*) as n from ingreso group by 1, 2),
-- ===== Productividad y capacidad =====
dias_habiles as (
    select count(*) as n from generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') d
    where extract(isodow from d) < 6 and not exists (select 1 from public.asueto a where a.id_pais = p_pais and a.fecha = d::date)
),
optimo_hh as (   -- tiempo promedio de horas hábiles por estadía del equipo elegido
    select avg(horas_habiles) as hh from dac where horas_habiles > 0
),
prod_persona as (
    select d.usuario, d.rol, count(distinct d.solicitud) as solicitudes,
           round((count(distinct d.solicitud)::numeric / greatest((select n from dias_habiles), 1)), 2) as por_dia,
           -- teórico: días hábiles × (9 HH ÷ tiempo óptimo); solo aplica a analistas DAC
           case when d.rol = 'DAC' then round(((select n from dias_habiles) * 9 / nullif((select hh from optimo_hh), 0))::numeric, 1) end as teorico,
           (select l.promedio_hh_sin_pend from lt_persona l where l.usuario = d.usuario and l.rol = d.rol) as hh_sin_pend
    from dac d group by d.usuario, d.rol
),
max_dia as (
    select usuario, fecha_hora::date as dia, count(distinct solicitud) as n from dac group by 1, 2
),
-- ===== Asesores: pendientes generados y rechazos (cualquier rol, dentro de la base) =====
ases as (
    select c.usuario, c.rol,
           count(distinct c.solicitud) as solicitudes,
           count(*) filter (where upper(c.estado) like 'PENDIENTE%') as pendientes,
           count(*) filter (where c.clase_estado = 'RECHAZADA' and upper(c.estado) like '%RECEP%') as rech_recepcion,
           count(*) filter (where c.clase_estado = 'RECHAZADA' and upper(c.estado) not like '%RECEP%') as rech_analista
    from ce_b c
    join sf on sf.solicitud = c.solicitud
    group by c.usuario, c.rol
)
select json_build_object(
  'dias_habiles', (select n from dias_habiles),
  'resultados', (select json_build_object('total', total, 'aprobadas', aprobadas, 'rechazadas', rechazadas,
        'rech_recepcion', rech_recepcion, 'desercion', desercion, 'en_proceso', en_proceso) from resultados),
  'lead_time', (select json_build_object('n', n, 'promedio_creacion_dias', round(promedio_creacion::numeric, 1),
        'promedio_asignacion_dias', round(promedio_asignacion::numeric, 1), 'promedio_hh_asignacion', round(promedio_hh_asignacion::numeric, 1)) from lt_resumen),
  'persona_lt', coalesce((select json_agg(json_build_object('usuario', usuario, 'rol', rol, 'estadias', estadias,
        'solicitudes', solicitudes, 'promedio_hh', promedio_hh, 'horas', horas, 'promedio_hh_sin_pend', promedio_hh_sin_pend) order by horas desc) from lt_persona), '[]'::json),
  'flujo_dia', coalesce((select json_agg(json_build_object('dia', dia, 'n', n) order by dia) from flujo_dia), '[]'::json),
  'flujo_hora', coalesce((select json_agg(json_build_object('hora', hora, 'n', n) order by hora) from flujo_hora), '[]'::json),
  'flujo_dia_hora', coalesce((select json_agg(json_build_object('dia', dia, 'hora', hora, 'n', n)) from flujo_dia_hora), '[]'::json),
  'productividad', coalesce((select json_agg(json_build_object('usuario', usuario, 'rol', rol, 'solicitudes', solicitudes,
        'por_dia', por_dia, 'teorico', teorico,
        'diferencia', case when teorico is not null then round((solicitudes - teorico)::numeric, 1) end,
        'hh_sin_pend', hh_sin_pend) order by solicitudes desc) from prod_persona), '[]'::json),
  'asesores', coalesce((select json_agg(json_build_object('usuario', usuario, 'rol', rol, 'solicitudes', solicitudes,
        'pendientes', pendientes,
        'pend_por_solicitud', round((pendientes::numeric / nullif(solicitudes, 0)), 2),
        'rech_recepcion', rech_recepcion,
        'rech_recepcion_pct', round((rech_recepcion::numeric / nullif(solicitudes, 0)), 4),
        'rech_analista', rech_analista,
        'rech_analista_pct', round((rech_analista::numeric / nullif(solicitudes, 0)), 4)
      ) order by (pendientes::numeric / nullif(solicitudes, 0)) desc nulls last) from ases), '[]'::json),
  'capacidad', json_build_object(
        'hh_promedio_estadia', (select round(hh::numeric, 2) from optimo_hh),
        'max_teorico_dia', (select round((9 / nullif(hh, 0))::numeric, 1) from optimo_hh),
        'max_observado_dia', (select coalesce(max(n), 0) from max_dia)),
  'pendientes', coalesce((select json_agg(json_build_object('grupo', grupo, 'orden', orden, 'n', n) order by orden) from grupos_pend), '[]'::json)
);
$$;

grant execute on function public.equipo_dac(smallint, date, date, boolean, text[], text) to authenticated;
revoke execute on function public.equipo_dac(smallint, date, date, boolean, text[], text) from anon;

notify pgrst, 'reload schema';
