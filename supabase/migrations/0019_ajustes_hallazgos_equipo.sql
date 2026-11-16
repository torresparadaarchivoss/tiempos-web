-- 0019_ajustes_hallazgos_equipo.sql
-- 1) Tipo PERSONAL se une a NO ASALARIADO (datos actuales y cargas futuras, por disparador).
-- 2) pendientes_generados: veces que las solicitudes pasaron por el estado PENDIENTES (Hallazgos).
-- 3) insights_distribucion: histograma del Lead Time con y sin retrocesos (reemplaza las cajas).
-- 4) equipo: nuevo parámetro p_sin_pend y comparación con/sin PENDIENTES en "Respuesta en el mismo día".
-- SECURITY INVOKER en las funciones de lectura: aplica RLS del usuario.

-- ===== 1) PERSONAL -> NO ASALARIADO =====
update public.solicitud set tipo_solicitud = 'NO ASALARIADO' where tipo_solicitud = 'PERSONAL';

create or replace function public.tg_unificar_tipo()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tipo_solicitud = 'PERSONAL' then
    new.tipo_solicitud := 'NO ASALARIADO';
  end if;
  return new;
end;
$$;

drop trigger if exists tr_solicitud_unificar_tipo on public.solicitud;
create trigger tr_solicitud_unificar_tipo
  before insert or update of tipo_solicitud on public.solicitud
  for each row execute function public.tg_unificar_tipo();
-- resumen_mensual no se toca: la app suma PERSONAL dentro de NO ASALARIADO al leerlo.

-- ===== 2) Pendientes generados =====
create or replace function public.pendientes_generados(
    p_pais smallint, p_desde date, p_hasta date,
    p_tipos text[] default null, p_canales text[] default null, p_resultados text[] default null
)
returns json language sql stable as $$
with canal_usuario as (
    select u.usuario, coalesce(nullif(u.canal, ''), 'SIN CANAL') as canal
    from public.usuario_operativo u where u.id_pais = p_pais
),
s as (
    select s.solicitud
    from public.solicitud s
    left join canal_usuario cu on cu.usuario = s.usuario_crea
    where s.id_pais = p_pais
      and s.fecha_creacion::date between p_desde and p_hasta
      and (p_tipos is null or s.tipo_solicitud = any(p_tipos))
      and (p_canales is null or coalesce(cu.canal, 'SIN CANAL') = any(p_canales))
      and (p_resultados is null or s.resultado_final = any(p_resultados))
),
p as (
    select ce.solicitud
    from public.ciclo_estado ce
    join s on s.solicitud = ce.solicitud
    where ce.id_pais = p_pais and upper(ce.estado) like 'PENDIENTE%'
)
select json_build_object(
  'veces', (select count(*) from p),
  'solicitudes_con', (select count(distinct solicitud) from p),
  'solicitudes_total', (select count(*) from s)
);
$$;
grant execute on function public.pendientes_generados(smallint, date, date, text[], text[], text[]) to authenticated;
revoke execute on function public.pendientes_generados(smallint, date, date, text[], text[], text[]) from anon;
alter function public.pendientes_generados(smallint, date, date, text[], text[], text[]) set statement_timeout = '90s';

-- ===== 3) Distribución del Lead Time con y sin retrocesos =====
-- Tramos de 4 HH hasta 60; el último tramo (15) agrupa 60 HH o más.
create or replace function public.insights_distribucion(
    p_pais smallint, p_desde date, p_hasta date,
    p_tipos text[] default null, p_canales text[] default null, p_resultados text[] default array['EXITOSA']
)
returns json language sql stable as $$
with canal_usuario as (
    select u.usuario, coalesce(nullif(u.canal, ''), 'SIN CANAL') as canal
    from public.usuario_operativo u where u.id_pais = p_pais
),
f as (
    select s.leadtime_habil_formalizado as lt,
           case when s.estados_repetidos > 0 then 'con' else 'sin' end as grupo
    from public.solicitud s
    left join canal_usuario cu on cu.usuario = s.usuario_crea
    where s.id_pais = p_pais and s.leadtime_habil_formalizado is not null
      and s.fecha_creacion::date between p_desde and p_hasta
      and (p_tipos is null or s.tipo_solicitud = any(p_tipos))
      and (p_canales is null or coalesce(cu.canal, 'SIN CANAL') = any(p_canales))
      and (p_resultados is null or s.resultado_final = any(p_resultados))
),
b as (
    select grupo, least(greatest(floor(lt / 4)::int, 0), 15) as tramo, count(*) as n
    from f group by 1, 2
)
select json_build_object(
  'tramos', coalesce((select json_agg(json_build_object('grupo', grupo, 'tramo', tramo, 'n', n) order by grupo, tramo) from b), '[]'::json),
  'n_sin', (select count(*) from f where grupo = 'sin'),
  'n_con', (select count(*) from f where grupo = 'con'),
  'med_sin', (select round((percentile_cont(0.5) within group (order by lt))::numeric, 2) from f where grupo = 'sin'),
  'med_con', (select round((percentile_cont(0.5) within group (order by lt))::numeric, 2) from f where grupo = 'con')
);
$$;
grant execute on function public.insights_distribucion(smallint, date, date, text[], text[], text[]) to authenticated;
revoke execute on function public.insights_distribucion(smallint, date, date, text[], text[], text[]) from anon;
alter function public.insights_distribucion(smallint, date, date, text[], text[], text[]) set statement_timeout = '90s';

-- ===== 4) Equipo con parámetro p_sin_pend =====
drop function if exists public.equipo(smallint, date, date, text[], text[], text[], text[], text[], text, boolean, text, text[]);

create or replace function public.equipo(
    p_pais          smallint,
    p_desde         date,
    p_hasta         date,
    p_tipos         text[]  default null,
    p_canales       text[]  default null,
    p_resultados    text[]  default array['EXITOSA'],
    p_roles         text[]  default null,        -- roles de productividad (null = por defecto)
    p_roles_resp    text[]  default null,        -- roles de respuesta el mismo día (null = por defecto)
    p_asig          text    default 'atiende',   -- 'atiende' | 'dejo'
    p_habil         boolean default true,        -- true = criterio hábil, false = calendario
    p_dim           text    default 'estado',    -- 'estado' | 'usuario' | 'rol'
    p_roles_dac     text[]  default array['DAC'],
    p_sin_pend      boolean default false        -- true = excluye las estadías en PENDIENTES
)
returns json
language sql
stable
as $$
with cal as (
    select d::date as dia,
           case when extract(isodow from d) = 7 or a.fecha is not null then 0
                when extract(isodow from d) = 6 then 14400
                else 32400 end as seg
    from generate_series('2026-01-01'::timestamp, '2030-12-31'::timestamp, interval '1 day') d
    left join public.asueto a on a.id_pais = p_pais and a.fecha = d::date
),
calc as (
    select dia, seg,
           sum(seg) over (order by dia rows unbounded preceding) - seg as acum,
           sum(case when seg > 0 then 1 else 0 end) over (order by dia rows unbounded preceding) as nhab
    from cal
),
roles as (
    select usuario, rol, activo from public.usuario_operativo where id_pais = p_pais
),
s_todas as (
    select s.solicitud, s.resultado_final, s.leadtime_habil_formalizado as lt
    from public.solicitud s
    left join public.usuario_operativo u on u.id_pais = s.id_pais and u.usuario = s.usuario_crea
    where s.id_pais = p_pais
      and s.fecha_creacion::date between p_desde and p_hasta
      and (p_tipos is null or s.tipo_solicitud = any(p_tipos))
      and (p_canales is null or coalesce(nullif(u.canal, ''), 'SIN CANAL') = any(p_canales))
),
s_form as (
    select solicitud, resultado_final, lt from s_todas where p_resultados is null or resultado_final = any(p_resultados)
),
cb as (
    select ce.solicitud, ce.orden_estado, ce.id_movimiento, ce.estado, ce.fecha_hora, ce.fecha_salida,
           ce.horas_habiles, ce.post_corte, ce.usuario_modifica as usuario,
           coalesce(r.rol, 'SIN CLASIFICAR') as rol, coalesce(r.activo, true) as activo,
           lead(ce.usuario_modifica) over (partition by ce.solicitud order by ce.orden_estado) as usuario_sale,
           lead(coalesce(r.rol, 'SIN CLASIFICAR')) over (partition by ce.solicitud order by ce.orden_estado) as rol_sale
    from public.ciclo_estado ce
    join s_todas st on st.solicitud = ce.solicitud
    left join roles r on r.usuario = ce.usuario_modifica
    where ce.id_pais = p_pais
),
tocada as (
    select solicitud, bool_or(rol = any(p_roles_dac)) as tocada from cb group by solicitud
),
-- ===== Productividad =====
prod as (
    select cb.solicitud, cb.usuario, cb.rol from cb
    where cb.post_corte = 0 and cb.usuario is not null and cb.activo
      and cb.solicitud in (select solicitud from s_form)
),
roles_prod as (select distinct rol from prod),
sel_prod as (
    select rol from roles_prod
    where (p_roles is not null and rol = any(p_roles))
       or (p_roles is null and rol not in ('SIN CLASIFICAR', 'JEFATURA', 'JEFATURA DAC')
           and rol <> all(p_roles_dac))
),
sel_prod_final as (
    select rol from sel_prod
    union all select rol from roles_prod where not exists (select 1 from sel_prod) and p_roles is null
),
dh as (
    select greatest(coalesce(sum(seg), 0)::numeric / 32400, 1) as dias
    from calc where dia between p_desde and p_hasta
),
prod_u as (
    select p.usuario, count(distinct p.solicitud) as solicitudes
    from prod p where p.rol in (select rol from sel_prod_final)
    group by p.usuario
),
-- ===== Respuesta el mismo día =====
resp_base as (
    select cb.solicitud, cb.estado, cb.fecha_hora, cb.fecha_salida, cb.post_corte, cb.id_movimiento,
           cb.rol, cb.usuario, cb.horas_habiles,
           (upper(cb.estado) like 'PENDIENTE%') as es_pend,
           case when p_asig = 'atiende' and cb.fecha_salida is not null then cb.rol_sale else cb.rol end as rol_r,
           case when p_asig = 'atiende' and cb.fecha_salida is not null then cb.usuario_sale else cb.usuario end as usuario_r
    from cb where cb.post_corte = 0
),
resp_dias as (
    select rb.*,
           case when p_habil then
             greatest(
               (cb_n.nhab - ca.nhab) - case when (ca.seg = 0 or rb.fecha_hora >= (ca.dia + interval '8 hours' + make_interval(secs => ca.seg))) then 1 else 0 end,
               0)
           else greatest((rb.fecha_salida::date - rb.fecha_hora::date), 0) end as dias
    from resp_base rb
    left join calc ca on ca.dia = rb.fecha_hora::date
    left join calc cb_n on cb_n.dia = rb.fecha_salida::date
    where rb.fecha_salida is null or rb.fecha_salida >= rb.fecha_hora
),
roles_resp as (select distinct rol_r from resp_dias where fecha_salida is not null and rol_r is not null),
sel_resp as (
    select rol_r from roles_resp
    where (p_roles_resp is not null and rol_r = any(p_roles_resp))
       or (p_roles_resp is null and rol_r = any(p_roles_dac))
),
e0 as (   -- estadías de los roles elegidos, con y sin PENDIENTES
    select * from resp_dias
    where (case when (select count(*) from sel_resp) > 0 then rol_r in (select rol_r from sel_resp) else true end)
),
e as (select * from e0 where not (p_sin_pend and es_pend)),
cerr as (select * from e where fecha_salida is not null),
pend as (select * from e where fecha_salida is null),
cerr_k as (
    select (case p_dim when 'usuario' then usuario_r when 'rol' then rol_r else estado end) as clave,
           solicitud, dias, (dias = 0) as mismo
    from cerr
),
t_grupo as (
    select clave, count(*) as estadias, count(distinct solicitud) as solicitudes,
           sum(case when mismo then 1 else 0 end) as mismo,
           percentile_cont(0.5) within group (order by dias::numeric) as mediana_dias
    from cerr_k group by clave
),
pend_k as (
    select (case p_dim when 'usuario' then usuario_r when 'rol' then rol_r else estado end) as clave, count(*) as n
    from pend group by 1
),
t_final as (
    select g.clave, g.solicitudes, g.estadias, g.mismo, g.estadias - g.mismo as cambio,
           round((g.mismo::numeric / nullif(g.estadias, 0)), 4) as pct_mismo,
           round(((g.estadias - g.mismo)::numeric / nullif(g.estadias, 0)), 4) as pct_cambio,
           round(g.mediana_dias::numeric, 0) as mediana_dias,
           coalesce(p.n, 0) as pendientes
    from t_grupo g left join pend_k p on p.clave = g.clave
),
dist as (
    select case when dias = 0 then 'Mismo día' when dias = 1 then '1 día' when dias = 2 then '2 días' else '3 o más' end as tramo,
           case when dias = 0 then 1 when dias = 1 then 2 when dias = 2 then 3 else 4 end as orden,
           count(*) as n
    from cerr group by 1, 2
),
comp as (   -- comparación con y sin PENDIENTES (estadías cerradas de los roles elegidos)
    select v.version,
           count(*) as estadias,
           round(avg(case when x.dias = 0 then 1.0 else 0 end)::numeric, 4) as pct_mismo,
           round((percentile_cont(0.5) within group (order by x.dias::numeric))::numeric, 1) as mediana_dias,
           round(avg(x.horas_habiles)::numeric, 2) as horas_prom,
           round(sum(x.horas_habiles)::numeric, 1) as horas
    from (values ('con'), ('sin')) v(version)
    join e0 x on x.fecha_salida is not null and (v.version = 'con' or not x.es_pend)
    group by v.version
)
select json_build_object(
  'dias_habiles', (select round(dias::numeric, 1) from dh),
  'prod_personas', (select count(*) from prod_u),
  'prod_promedio_dia', (select round(avg(solicitudes / (select dias from dh))::numeric, 2) from prod_u),
  'prod_mediana', (select percentile_cont(0.5) within group (order by solicitudes) from prod_u),
  'prod_roles', coalesce((select json_agg(rol order by rol) from roles_prod), '[]'::json),
  'prod_roles_sel', coalesce((select json_agg(rol) from sel_prod_final), '[]'::json),
  'prod_usuarios', coalesce((select json_agg(json_build_object('usuario', usuario, 'solicitudes', solicitudes,
        'por_dia', round((solicitudes / (select dias from dh))::numeric, 2)) order by solicitudes desc) from prod_u), '[]'::json),
  'dac_solicitudes_con', (select count(*) from s_todas st join tocada t on t.solicitud = st.solicitud where t.tocada),
  'dac_solicitudes_total', (select count(*) from s_todas),
  'dac_dif_medianas', (select round((
        percentile_cont(0.5) within group (order by lt) filter (where solicitud in (select solicitud from tocada where tocada) and lt is not null)
      - percentile_cont(0.5) within group (order by lt) filter (where solicitud in (select solicitud from tocada where not tocada) and lt is not null))::numeric, 1) from s_form),
  'dac_conv_con', (select round(avg(case when st.resultado_final = 'EXITOSA' then 1.0 else 0 end)::numeric, 4) from s_todas st join tocada t on t.solicitud = st.solicitud where t.tocada),
  'dac_conv_sin', (select round(avg(case when st.resultado_final = 'EXITOSA' then 1.0 else 0 end)::numeric, 4) from s_todas st join tocada t on t.solicitud = st.solicitud where not t.tocada),
  'dac_horas_pct', (select round((sum(horas_habiles) filter (where rol = any(p_roles_dac)) / nullif(sum(horas_habiles), 0))::numeric, 4) from cb where post_corte = 0),
  'dac_usuarios', coalesce((select json_agg(json_build_object('usuario', usuario, 'solicitudes', solicitudes,
        'movimientos', movimientos, 'horas', round(horas::numeric, 1)) order by movimientos desc) from (
        select usuario, count(distinct solicitud) as solicitudes, count(*) as movimientos, sum(horas_habiles) as horas
        from cb where post_corte = 0 and rol = any(p_roles_dac) and usuario is not null group by usuario) x), '[]'::json),
  'resp_roles', coalesce((select json_agg(rol_r order by rol_r) from roles_resp), '[]'::json),
  'resp_roles_sel', coalesce((select json_agg(rol_r) from sel_resp), '[]'::json),
  'resp_cerradas', (select count(*) from cerr),
  'resp_mismo', (select round(avg(case when dias = 0 then 1.0 else 0 end)::numeric, 4) from cerr),
  'resp_cambio', (select round(avg(case when dias > 0 then 1.0 else 0 end)::numeric, 4) from cerr),
  'resp_pendientes', (select count(*) from pend),
  'resp_solicitudes_mismo', (select round(avg(case when todos then 1.0 else 0 end)::numeric, 4) from (
        select solicitud, bool_and(dias = 0) as todos from cerr group by solicitud) z),
  'resp_tabla', coalesce((select json_agg(json_build_object('clave', clave, 'solicitudes', solicitudes,
        'estadias', estadias, 'mismo', mismo, 'pct_mismo', pct_mismo, 'cambio', cambio, 'pct_cambio', pct_cambio,
        'mediana_dias', mediana_dias, 'pendientes', pendientes) order by estadias desc) from t_final), '[]'::json),
  'resp_distribucion', coalesce((select json_agg(json_build_object('tramo', tramo, 'n', n) order by orden) from dist), '[]'::json),
  'pend_comp', json_build_object(
        'con', (select json_build_object('estadias', estadias, 'pct_mismo', pct_mismo, 'mediana_dias', mediana_dias, 'horas_prom', horas_prom, 'horas', horas) from comp where version = 'con'),
        'sin', (select json_build_object('estadias', estadias, 'pct_mismo', pct_mismo, 'mediana_dias', mediana_dias, 'horas_prom', horas_prom, 'horas', horas) from comp where version = 'sin'),
        'estadias_pend', (select count(*) from e0 where es_pend and fecha_salida is not null),
        'horas_pend', (select round(coalesce(sum(horas_habiles), 0)::numeric, 1) from e0 where es_pend and fecha_salida is not null))
);
$$;

grant execute on function public.equipo(smallint, date, date, text[], text[], text[], text[], text[], text, boolean, text, text[], boolean) to authenticated;
revoke execute on function public.equipo(smallint, date, date, text[], text[], text[], text[], text[], text, boolean, text, text[], boolean) from anon;
alter function public.equipo(smallint, date, date, text[], text[], text[], text[], text[], text, boolean, text, text[], boolean) set statement_timeout = '90s';

notify pgrst, 'reload schema';
