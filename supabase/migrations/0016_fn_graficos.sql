-- 0016_fn_graficos.sql
-- Datos para gráficos que faltaban: box plot de retrocesos (Insights) y barras/histograma de Abiertas.
-- SECURITY INVOKER: aplica RLS.

create or replace function public.insights_cuartiles(
    p_pais smallint, p_desde date, p_hasta date,
    p_tipos text[] default null, p_canales text[] default null, p_resultados text[] default array['EXITOSA']
)
returns json language sql stable as $$
with canal_usuario as (
    select u.usuario, coalesce(nullif(u.canal, ''), 'SIN CANAL') as canal
    from public.usuario_operativo u where u.id_pais = p_pais
),
f as (
    select s.leadtime_habil_formalizado as lt, s.estados_repetidos
    from public.solicitud s
    left join canal_usuario cu on cu.usuario = s.usuario_crea
    where s.id_pais = p_pais and s.leadtime_habil_formalizado is not null
      and s.fecha_creacion::date between p_desde and p_hasta
      and (p_tipos is null or s.tipo_solicitud = any(p_tipos))
      and (p_canales is null or coalesce(cu.canal, 'SIN CANAL') = any(p_canales))
      and (p_resultados is null or s.resultado_final = any(p_resultados))
)
select json_build_object(
  'sin', (select json_build_object(
            'n', count(*),
            'min', round(min(lt)::numeric, 2),
            'p25', round((percentile_cont(0.25) within group (order by lt))::numeric, 2),
            'mediana', round((percentile_cont(0.5) within group (order by lt))::numeric, 2),
            'p75', round((percentile_cont(0.75) within group (order by lt))::numeric, 2),
            'max', round(max(lt)::numeric, 2))
          from f where estados_repetidos = 0),
  'con', (select json_build_object(
            'n', count(*),
            'min', round(min(lt)::numeric, 2),
            'p25', round((percentile_cont(0.25) within group (order by lt))::numeric, 2),
            'mediana', round((percentile_cont(0.5) within group (order by lt))::numeric, 2),
            'p75', round((percentile_cont(0.75) within group (order by lt))::numeric, 2),
            'max', round(max(lt)::numeric, 2))
          from f where estados_repetidos > 0)
);
$$;
grant execute on function public.insights_cuartiles(smallint, date, date, text[], text[], text[]) to authenticated;
revoke execute on function public.insights_cuartiles(smallint, date, date, text[], text[], text[]) from anon;

create or replace function public.abiertas_graficos(
    p_pais smallint, p_desde date default null, p_hasta date default null,
    p_tipos text[] default null, p_canales text[] default null, p_todo boolean default false
)
returns json language sql stable as $$
with canal_usuario as (
    select u.usuario, coalesce(nullif(u.canal, ''), 'SIN CANAL') as canal
    from public.usuario_operativo u where u.id_pais = p_pais
),
s as (
    select sol.estado_final, sol.resultado_final, sol.dias_sin_movimiento
    from public.solicitud sol
    left join canal_usuario cu on cu.usuario = sol.usuario_crea
    where sol.id_pais = p_pais
      and sol.resultado_final in ('EN_PROCESO', 'ESTANCADA', 'SOLO_UN_ESTADO')
      and (p_todo or sol.fecha_creacion::date between p_desde and p_hasta)
      and (p_tipos is null or sol.tipo_solicitud = any(p_tipos))
      and (p_canales is null or coalesce(cu.canal, 'SIN CANAL') = any(p_canales))
)
select json_build_object(
  'por_estado', coalesce((select json_agg(json_build_object('estado', estado_final, 'resultado', resultado_final, 'n', n)
                 order by n desc) from (select estado_final, resultado_final, count(*) n from s group by 1, 2) x), '[]'::json),
  'dias', coalesce((select json_agg(json_build_object('tramo', tramo, 'n', n) order by orden) from (
            select case when dias_sin_movimiento <= 2 then '0–2' when dias_sin_movimiento <= 7 then '3–7'
                        when dias_sin_movimiento <= 15 then '8–15' when dias_sin_movimiento <= 29 then '16–29'
                        else '30+' end as tramo,
                   case when dias_sin_movimiento <= 2 then 1 when dias_sin_movimiento <= 7 then 2
                        when dias_sin_movimiento <= 15 then 3 when dias_sin_movimiento <= 29 then 4 else 5 end as orden,
                   count(*) as n
            from s where dias_sin_movimiento is not null and resultado_final in ('EN_PROCESO', 'ESTANCADA')
            group by 1, 2) d), '[]'::json)
);
$$;
grant execute on function public.abiertas_graficos(smallint, date, date, text[], text[], boolean) to authenticated;
revoke execute on function public.abiertas_graficos(smallint, date, date, text[], text[], boolean) from anon;
