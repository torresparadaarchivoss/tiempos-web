-- 0011_fn_insights.sql
-- Cálculos de la página Insights, dentro de la base. SECURITY INVOKER: aplica RLS del usuario.
-- Reglas copiadas de views/insights.py: mínimo 5 formalizadas por grupo (MIN_N), SLA de 24 HH.

create or replace function public.insights(
    p_pais        smallint,
    p_desde       date,
    p_hasta       date,
    p_tipos       text[] default null,
    p_canales     text[] default null,
    p_resultados  text[] default null,
    p_dimension   text   default 'promotor'
)
returns json
language sql
stable
as $$
with canal_usuario as (
    select u.usuario, coalesce(nullif(u.canal, ''), 'SIN CANAL') as canal
    from public.usuario_operativo u where u.id_pais = p_pais
),
sol_all as (   -- todas las creadas del periodo (volumen y conversión)
    select s.solicitud, s.fecha_creacion, s.resultado_final, s.estados_repetidos,
           s.tipo_solicitud, s.promotor, s.sucursal, s.usuario_crea,
           s.leadtime_habil_formalizado as lt,
           coalesce(cu.canal, 'SIN CANAL') as canal
    from public.solicitud s
    left join canal_usuario cu on cu.usuario = s.usuario_crea
    where s.id_pais = p_pais
      and s.fecha_creacion::date between p_desde and p_hasta
      and (p_tipos is null or s.tipo_solicitud = any(p_tipos))
      and (p_canales is null or coalesce(cu.canal, 'SIN CANAL') = any(p_canales))
),
f as (         -- formalizadas del filtro de resultado (tiempos)
    select * from sol_all
    where lt is not null
      and (p_resultados is null or resultado_final = any(p_resultados))
),
f_stats as (
    select count(*) as n,
           count(*) filter (where estados_repetidos = 0) as n_sin,
           count(*) filter (where estados_repetidos > 0) as n_con,
           percentile_cont(0.5) within group (order by lt) filter (where estados_repetidos = 0) as med_sin,
           percentile_cont(0.5) within group (order by lt) filter (where estados_repetidos > 0) as med_con
    from f
),
por_tipo as (
    select tipo_solicitud as grupo, count(*) as formalizadas,
           percentile_cont(0.5) within group (order by lt) as mediana,
           percentile_cont(0.9) within group (order by lt) as p90,
           avg(case when lt <= 24 then 1.0 else 0 end) as sla
    from f group by tipo_solicitud having count(*) >= 5
),
por_canal as (
    select canal as grupo, count(*) as formalizadas,
           percentile_cont(0.5) within group (order by lt) as mediana,
           percentile_cont(0.9) within group (order by lt) as p90,
           avg(case when lt <= 24 then 1.0 else 0 end) as sla
    from f group by canal having count(*) >= 5
),
por_dia as (
    select case extract(isodow from fecha_creacion)::int
             when 1 then 'Lun' when 2 then 'Mar' when 3 then 'Mié' when 4 then 'Jue'
             when 5 then 'Vie' when 6 then 'Sáb' else 'Dom' end as grupo,
           extract(isodow from fecha_creacion)::int as orden,
           count(*) as formalizadas,
           percentile_cont(0.5) within group (order by lt) as mediana,
           percentile_cont(0.9) within group (order by lt) as p90,
           avg(case when lt <= 24 then 1.0 else 0 end) as sla
    from f group by 1, 2 having count(*) >= 5
),
heat as (
    select extract(isodow from fecha_creacion)::int as dia,
           extract(hour from fecha_creacion)::int   as hora,
           percentile_cont(0.5) within group (order by lt) as mediana
    from f
    where extract(hour from fecha_creacion) between 7 and 18
    group by 1, 2
),
ranking as (
    select case p_dimension
             when 'sucursal' then sa.sucursal
             when 'usuario' then sa.usuario_crea
             else sa.promotor end as grupo,
           count(*) as creadas,
           count(*) filter (where sa.resultado_final = 'EXITOSA') as formalizadas_tot,
           avg(case when sa.resultado_final = 'EXITOSA' then 1.0 else 0 end) as conversion,
           percentile_cont(0.5) within group (order by sa.lt) filter (where sa.lt is not null) as mediana,
           avg(case when sa.lt <= 24 then 1.0 else 0 end) filter (where sa.lt is not null) as sla,
           count(sa.lt) as formalizadas
    from sol_all sa
    where case p_dimension
             when 'sucursal' then sa.sucursal
             when 'usuario' then sa.usuario_crea
             else sa.promotor end is not null
    group by 1 having count(sa.lt) >= 5
),
tendencia as (
    select date_trunc('month', fecha_creacion)::date as mes, resultado_final, count(*) as n
    from sol_all group by 1, 2
),
conv_mes as (
    select date_trunc('month', fecha_creacion)::date as mes,
           avg(case when resultado_final = 'EXITOSA' then 1.0 else 0 end) as conv
    from sol_all group by 1
),
-- Retrocesos: transición hacia un estado ya visitado (antes del corte), como en views/insights.py
ciclo_sol as (
    select ce.solicitud, ce.orden_estado, ce.estado
    from public.ciclo_estado ce
    join sol_all on sol_all.solicitud = ce.solicitud
    where ce.id_pais = p_pais and ce.post_corte = 0
),
ciclo_seq as (
    select solicitud, estado,
           lag(estado) over (partition by solicitud order by orden_estado) as desde,
           row_number() over (partition by solicitud, estado order by orden_estado) as veces_visto
    from ciclo_sol
),
retro as (
    select desde, estado, count(*) as veces, count(distinct solicitud) as solicitudes
    from ciclo_seq where veces_visto > 1 and desde is not null
    group by desde, estado order by veces desc limit 12
),
tot_conv as (select count(*) as n from sol_all)
select json_build_object(
  'n_formalizadas', (select n from f_stats),
  'pct_sin_retrocesos', (select round((n_sin::numeric / nullif(n,0)), 4) from f_stats),
  'costo_retroceso', (select round((med_con - med_sin)::numeric, 2) from f_stats),
  'tipo', (select json_agg(json_build_object('grupo',grupo,'formalizadas',formalizadas,'mediana',round(mediana::numeric,2),'p90',round(p90::numeric,2),'sla',round(sla::numeric,4)) order by mediana desc) from por_tipo),
  'canal', (select json_agg(json_build_object('grupo',grupo,'formalizadas',formalizadas,'mediana',round(mediana::numeric,2),'p90',round(p90::numeric,2),'sla',round(sla::numeric,4)) order by mediana desc) from por_canal),
  'dia', (select json_agg(json_build_object('grupo',grupo,'orden',orden,'formalizadas',formalizadas,'mediana',round(mediana::numeric,2),'p90',round(p90::numeric,2),'sla',round(sla::numeric,4)) order by orden) from por_dia),
  'heat', (select json_agg(json_build_object('dia',dia,'hora',hora,'mediana',round(mediana::numeric,2))) from heat),
  'box', (select json_build_object(
            'sin', json_build_object('n',(select n_sin from f_stats)),
            'con', json_build_object('n',(select n_con from f_stats))
          )),
  'ranking', (select json_agg(json_build_object('grupo',grupo,'creadas',creadas,'formalizadas',formalizadas,'conversion',round(conversion::numeric,4),'mediana',round(mediana::numeric,2),'sla',round(sla::numeric,4)) order by mediana desc) from ranking),
  'tendencia', (select json_agg(json_build_object('mes',mes,'resultado',resultado_final,'n',n) order by mes) from tendencia),
  'conversion_mes', (select json_agg(json_build_object('mes',mes,'conv',round(conv::numeric,4)) order by mes) from conv_mes),
  'retrocesos', (select json_agg(json_build_object('desde',desde,'hacia',estado,'veces',veces,'solicitudes',solicitudes)) from retro),
  'creadas', (select n from tot_conv)
);
$$;

grant execute on function public.insights(smallint, date, date, text[], text[], text[], text) to authenticated;
revoke execute on function public.insights(smallint, date, date, text[], text[], text[], text) from anon;
