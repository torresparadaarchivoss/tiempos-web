-- 0010_fn_cuellos.sql
-- Cálculo de la página Cuellos y reprocesos, dentro de la base.
-- SECURITY INVOKER (por defecto): aplica RLS del usuario que consulta, no permisos elevados.

create or replace function public.cuellos(
    p_pais        smallint,
    p_desde       date,
    p_hasta       date,
    p_tipos       text[] default null,
    p_canales     text[] default null,
    p_resultados  text[] default null
)
returns json
language sql
stable
as $$
with canal_usuario as (
    select u.usuario, coalesce(nullif(u.canal, ''), 'SIN CANAL') as canal
    from public.usuario_operativo u
    where u.id_pais = p_pais
),
sol as (
    select s.solicitud, s.resultado_final, s.estados_repetidos, s.cliente_reprocesado,
           coalesce(cu.canal, 'SIN CANAL') as canal
    from public.solicitud s
    left join canal_usuario cu on cu.usuario = s.usuario_crea
    where s.id_pais = p_pais
      and s.fecha_creacion::date between p_desde and p_hasta
      and (p_tipos is null or s.tipo_solicitud = any(p_tipos))
      and (p_canales is null or coalesce(cu.canal, 'SIN CANAL') = any(p_canales))
),
-- Los tiempos por estado sí se filtran por resultado; los indicadores de retrocesos no (igual que el original)
sol_tiempos as (
    select solicitud from sol
    where p_resultados is null or resultado_final = any(p_resultados)
),
c as (
    select ce.estado, ce.solicitud, ce.horas_habiles
    from public.ciclo_estado ce
    join sol_tiempos on sol_tiempos.solicitud = ce.solicitud
    where ce.id_pais = p_pais
      and ce.horas_habiles is not null
      and ce.post_corte = 0
),
g as (
    select estado,
           count(distinct solicitud)                                   as solicitudes,
           percentile_cont(0.5) within group (order by horas_habiles)  as mediana,
           percentile_cont(0.9) within group (order by horas_habiles)  as p90,
           sum(horas_habiles)                                          as horas
    from c
    group by estado
),
tot as (select coalesce(sum(horas), 0) as horas_total from g)
select json_build_object(
    'solicitudes_periodo', (select count(*) from sol),
    'pct_con_retrocesos',  (select avg(case when estados_repetidos > 0 then 1.0 else 0 end) from sol),
    'retrocesos_promedio', (select avg(estados_repetidos::numeric) from sol),
    'pct_cliente_reprocesado', (select avg(cliente_reprocesado::numeric) from sol),
    'estados', coalesce((
        select json_agg(json_build_object(
            'estado', estado,
            'solicitudes', solicitudes,
            'mediana', round(mediana::numeric, 2),
            'p90', round(p90::numeric, 2),
            'horas', round(horas::numeric, 2),
            'share', round((horas / nullif((select horas_total from tot), 0))::numeric, 4)
        ) order by horas desc)
        from g), '[]'::json)
);
$$;

-- Permiso para usuarios autenticados (RLS sigue aplicando dentro de la función)
grant execute on function public.cuellos(smallint, date, date, text[], text[], text[]) to authenticated;
revoke execute on function public.cuellos(smallint, date, date, text[], text[], text[]) from anon;
