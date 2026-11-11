-- 0013_fn_equipo.sql
-- Equipo y DAC: productividad, gestión DAC y respuesta el mismo día. SECURITY INVOKER (RLS).
-- Calendario: L-V 8-17, sábado 8-12, domingo y asuetos sin horas (igual que core/model.py).
-- Asuetos: tabla public.asueto por país. Los de El Salvador se cargan en el bloque al final.

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
    p_roles_dac     text[]  default array['DAC']
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
s_todas as (   -- solicitudes del periodo con tipo y canal (sin filtro de resultado)
    select s.solicitud, s.resultado_final, s.leadtime_habil_formalizado as lt
    from public.solicitud s
    left join public.usuario_operativo u on u.id_pais = s.id_pais and u.usuario = s.usuario_crea
    where s.id_pais = p_pais
      and s.fecha_creacion::date between p_desde and p_hasta
      and (p_tipos is null or s.tipo_solicitud = any(p_tipos))
      and (p_canales is null or coalesce(nullif(u.canal, ''), 'SIN CANAL') = any(p_canales))
),
s_form as (
    select * from s_todas where p_resultados is null or resultado_final = any(p_resultados)
),
cb as (   -- movimientos de todas las solicitudes del periodo, con rol y usuario
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
    select cb.* from cb
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
dh as (   -- días hábiles equivalentes del periodo (mínimo 1)
    select greatest(coalesce(sum(seg), 0)::numeric / 32400, 1) as dias
    from calc where dia between p_desde and p_hasta
),
prod_u as (
    select p.usuario, count(distinct p.solicitud) as solicitudes
    from prod p where p.rol in (select rol from sel_prod_final)
    group by p.usuario
),
-- ===== Respuesta el mismo día (días según el criterio) =====
resp_base as (
    select cb.solicitud, cb.estado, cb.fecha_hora, cb.fecha_salida, cb.post_corte, cb.id_movimiento,
           cb.rol, cb.usuario,
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
e as (
    select * from resp_dias
    where (case when (select count(*) from sel_resp) > 0 then rol_r in (select rol_r from sel_resp) else true end)
),
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
           count(*) as n
    from cerr group by 1
)
select json_build_object(
  'dias_habiles', (select round(dias::numeric, 1) from dh),
  'prod_personas', (select count(*) from prod_u),
  'prod_promedio_dia', (select round(avg(solicitudes / (select dias from dh))::numeric, 2) from prod_u),
  'prod_mediana', (select percentile_cont(0.5) within group (order by solicitudes) from prod_u),
  'prod_roles', (select json_agg(rol order by rol) from roles_prod),
  'prod_roles_sel', (select json_agg(rol) from sel_prod_final),
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
  'resp_roles', (select json_agg(rol_r order by rol_r) from roles_resp),
  'resp_roles_sel', (select json_agg(rol_r) from sel_resp),
  'resp_cerradas', (select count(*) from cerr),
  'resp_mismo', (select round(avg(case when dias = 0 then 1.0 else 0 end)::numeric, 4) from cerr),
  'resp_cambio', (select round(avg(case when dias > 0 then 1.0 else 0 end)::numeric, 4) from cerr),
  'resp_pendientes', (select count(*) from pend),
  'resp_solicitudes_mismo', (select round(avg(case when todos then 1.0 else 0 end)::numeric, 4) from (
        select solicitud, bool_and(dias = 0) as todos from cerr group by solicitud) z),
  'resp_tabla', coalesce((select json_agg(json_build_object('clave', clave, 'solicitudes', solicitudes,
        'estadias', estadias, 'mismo', mismo, 'pct_mismo', pct_mismo, 'cambio', cambio, 'pct_cambio', pct_cambio,
        'mediana_dias', mediana_dias, 'pendientes', pendientes) order by estadias desc) from t_final), '[]'::json),
  'resp_distribucion', coalesce((select json_agg(json_build_object('tramo', tramo, 'n', n)) from dist), '[]'::json)
);
$$;

grant execute on function public.equipo(smallint, date, date, text[], text[], text[], text[], text[], text, boolean, text, text[]) to authenticated;
revoke execute on function public.equipo(smallint, date, date, text[], text[], text[], text[], text[], text, boolean, text, text[]) from anon;

-- Asuetos de El Salvador (los mismos de core/config.py). Otros países: pendiente confirmar sus asuetos.
insert into public.asueto (id_pais, fecha, descripcion) values
  (4, '2026-01-01', 'Año nuevo'), (4, '2026-04-02', 'Semana santa'), (4, '2026-04-03', 'Semana santa'),
  (4, '2026-04-04', 'Semana santa'), (4, '2026-04-05', 'Semana santa'), (4, '2026-05-01', 'Día del trabajo'),
  (4, '2026-05-10', 'Día de la madre'), (4, '2026-06-17', 'Día del padre'), (4, '2026-08-05', 'Fiestas agostinas'),
  (4, '2026-08-06', 'Fiestas agostinas'), (4, '2026-09-15', 'Independencia'), (4, '2026-11-02', 'Día de difuntos'),
  (4, '2026-12-25', 'Navidad')
on conflict (id_pais, fecha) do nothing;
