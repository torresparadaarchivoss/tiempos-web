-- 0012_fn_abiertas_consulta.sql
-- Abiertas y posibles errores, y Consulta por solicitud. SECURITY INVOKER: aplica RLS.
-- Reglas copiadas de views/abiertas.py y views/explorador.py (SLA 24 HH; riesgo desde el 75% del SLA).

create or replace function public.abiertas(
    p_pais     smallint,
    p_desde    date default null,
    p_hasta    date default null,
    p_tipos    text[] default null,
    p_canales  text[] default null,
    p_todo     boolean default false,
    p_sla      numeric default 24
)
returns json
language sql
stable
as $$
with canal_usuario as (
    select u.usuario, coalesce(nullif(u.canal, ''), 'SIN CANAL') as canal, u.rol
    from public.usuario_operativo u where u.id_pais = p_pais
),
base as (   -- todas las solicitudes del periodo (filtros de tipo y canal), para el denominador
    select s.solicitud, s.resultado_final
    from public.solicitud s
    left join canal_usuario cu on cu.usuario = s.usuario_crea
    where s.id_pais = p_pais
      and (p_todo or s.fecha_creacion::date between p_desde and p_hasta)
      and (p_tipos is null or s.tipo_solicitud = any(p_tipos))
      and (p_canales is null or coalesce(cu.canal, 'SIN CANAL') = any(p_canales))
),
s as (
    select sol.solicitud, sol.resultado_final, sol.estado_final, sol.dias_sin_movimiento,
           sol.leadtime_habil_horas as hh, sol.fecha_creacion, sol.fecha_ultimo_mov, sol.estados_visitados,
           sol.tipo_solicitud, sol.promotor, coalesce(cu.canal, 'SIN CANAL') as canal,
           upper(coalesce(sol.estado_final, '')) as ef,
           (upper(coalesce(sol.estado_final, '')) ~ '(ANULAD|CANCELAD|DESIST|\mTUD\M|RECHAZ|DENEGAD|DESEMBOLSAD|CERRAD|FINALIZAD|DECLINAD|NO INTERES)') as terminal
    from public.solicitud sol
    left join canal_usuario cu on cu.usuario = sol.usuario_crea
    where sol.id_pais = p_pais
      and sol.resultado_final in ('EN_PROCESO', 'ESTANCADA', 'SOLO_UN_ESTADO')
      and (p_todo or sol.fecha_creacion::date between p_desde and p_hasta)
      and (p_tipos is null or sol.tipo_solicitud = any(p_tipos))
      and (p_canales is null or coalesce(cu.canal, 'SIN CANAL') = any(p_canales))
),
ult as (    -- último movimiento de cada abierta: usuario y rol
    select distinct on (ce.solicitud) ce.solicitud, ce.usuario_modifica
    from public.ciclo_estado ce
    join s on s.solicitud = ce.solicitud
    where ce.id_pais = p_pais
    order by ce.solicitud, ce.orden_estado desc
),
lista as (
    select s.solicitud, s.resultado_final, s.estado_final, s.tipo_solicitud, s.canal, s.promotor,
           s.fecha_creacion, s.fecha_ultimo_mov, s.dias_sin_movimiento, s.hh,
           ult.usuario_modifica as ultimo_usuario,
           coalesce(cu2.rol, 'SIN CLASIFICAR') as ultimo_rol,
           s.terminal,
           (s.resultado_final <> 'EN_PROCESO' or s.terminal) as posible_error,
           array_remove(array[
               case when s.terminal then 'Estado final parece terminal: revisar clasificación' end,
               case when s.resultado_final = 'SOLO_UN_ESTADO' then 'Un solo estado: no avanzó desde la creación' end,
               case when s.resultado_final = 'ESTANCADA' then 'Estancada: 30+ días sin movimiento' end,
               case when s.resultado_final = 'EN_PROCESO' and s.hh > p_sla then 'Supera el SLA estando abierta' end,
               case when s.resultado_final = 'EN_PROCESO' and s.hh > 0.75 * p_sla and s.hh <= p_sla
                    then 'En riesgo: más del 75% del SLA' end
           ], null) as alertas
    from s
    left join ult on ult.solicitud = s.solicitud
    left join canal_usuario cu2 on cu2.usuario = ult.usuario_modifica
),
ef as (
    select estado_final, count(*) as solicitudes,
           percentile_cont(0.5) within group (order by dias_sin_movimiento) as dias_mediana,
           bool_or(terminal) as parece_terminal
    from s group by estado_final
)
select json_build_object(
    'total_base', (select count(*) from base),
    'abiertas', (select count(*) from s),
    'en_proceso', (select count(*) from s where resultado_final = 'EN_PROCESO'),
    'estancadas', (select count(*) from s where resultado_final = 'ESTANCADA'),
    'solo_un_estado', (select count(*) from s where resultado_final = 'SOLO_UN_ESTADO'),
    'terminal', (select count(*) from s where terminal),
    'en_proceso_sobre_sla', (select count(*) from s where resultado_final = 'EN_PROCESO' and hh > p_sla),
    'en_proceso_riesgo', (select count(*) from s where resultado_final = 'EN_PROCESO' and hh > 0.75 * p_sla and hh <= p_sla),
    'posibles_errores', (select count(*) from lista where posible_error),
    'sla', p_sla,
    'estados_finales', coalesce((select json_agg(json_build_object(
        'estado_final', estado_final, 'solicitudes', solicitudes,
        'dias_mediana', round(dias_mediana::numeric, 0), 'parece_terminal', parece_terminal)
        order by solicitudes desc) from ef), '[]'::json),
    'lista', coalesce((select json_agg(json_build_object(
        'solicitud', solicitud, 'resultado', resultado_final, 'estado_actual', estado_final,
        'alertas', array_to_string(alertas, ' · '), 'tipo', tipo_solicitud, 'canal', canal, 'promotor', promotor,
        'creacion', fecha_creacion, 'ultimo_mov', fecha_ultimo_mov, 'dias_sin_mov', dias_sin_movimiento,
        'hh_abierta', round(hh::numeric, 1), 'ultimo_usuario', ultimo_usuario, 'ultimo_rol', ultimo_rol,
        'posible_error', posible_error)
        order by posible_error desc, dias_sin_movimiento desc nulls last) from (select * from lista order by posible_error desc, dias_sin_movimiento desc nulls last limit 500) l), '[]'::json)
);
$$;

create or replace function public.consulta(p_pais smallint, p_solicitud bigint default null)
returns json
language sql
stable
as $$
with roles as (
    select u.usuario, u.rol from public.usuario_operativo u where u.id_pais = p_pais
),
rec as (    -- sin número: las 8 más recientes
    select s.solicitud, s.resultado_final, s.estado_final, s.tipo_solicitud, s.fecha_creacion
    from public.solicitud s where s.id_pais = p_pais
    order by s.fecha_creacion desc limit 8
),
sol as (
    select s.* from public.solicitud s where s.id_pais = p_pais and s.solicitud = p_solicitud
),
mov as (
    select ce.orden_estado, ce.estado, ce.fecha_hora, ce.fecha_fin_efectiva, ce.horas_habiles, ce.horas_estado,
           ce.usuario_modifica, coalesce(r.rol, 'SIN CLASIFICAR') as rol, ce.post_corte
    from public.ciclo_estado ce
    left join roles r on r.usuario = ce.usuario_modifica
    where ce.id_pais = p_pais and ce.solicitud = p_solicitud
),
dac as (select count(*) as movs from mov where rol = 'DAC')
select json_build_object(
    'recientes', coalesce((select json_agg(json_build_object('solicitud', solicitud, 'resultado', resultado_final,
        'estado_actual', estado_final, 'tipo', tipo_solicitud, 'creacion', fecha_creacion) order by fecha_creacion desc) from rec), '[]'::json),
    'solicitud', (select json_build_object(
        'solicitud', solicitud, 'resultado', resultado_final, 'estado_final', estado_final,
        'tipo', tipo_solicitud, 'promotor', promotor, 'sucursal', sucursal,
        'leadtime_formalizado', round(leadtime_habil_formalizado::numeric, 1),
        'hh_analisis', round(leadtime_habil_horas::numeric, 1), 'solo_un_estado', resultado_final = 'SOLO_UN_ESTADO',
        'movs_dac', (select movs from dac), 'tocada_dac', (select movs from dac) > 0)
        from sol limit 1),
    'movimientos', coalesce((select json_agg(json_build_object(
        'orden', orden_estado, 'estado', estado, 'fecha_hora', fecha_hora, 'fecha_fin', fecha_fin_efectiva,
        'hh', round(horas_habiles::numeric, 2), 'horas_estado', round(horas_estado::numeric, 1),
        'usuario', usuario_modifica, 'rol', rol, 'fuera_analisis', post_corte = 1)
        order by orden_estado) from mov), '[]'::json)
);
$$;

grant execute on function public.abiertas(smallint, date, date, text[], text[], boolean, numeric) to authenticated;
grant execute on function public.consulta(smallint, bigint) to authenticated;
revoke execute on function public.abiertas(smallint, date, date, text[], text[], boolean, numeric) from anon;
revoke execute on function public.consulta(smallint, bigint) from anon;
