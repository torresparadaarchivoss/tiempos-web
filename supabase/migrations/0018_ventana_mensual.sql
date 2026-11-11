-- 0018_ventana_mensual.sql
-- Ventana móvil de 3 meses: cada mes se elimina el mes más antiguo y se agrega el mes en curso.
-- Flujo: (1) tu equipo extrae CSV del DWH; (2) \copy los carga en tablas temporales stg_*;
--        (3) select aplicar_ventana('YYYY-MM-01'); (4) las temporales se vacían.
-- Solo el administrador ejecuta esto (SQL Editor o psql). Las tablas stg_* no tienen RLS: no son para la app.

create unlogged table if not exists public.stg_solicitud (like public.solicitud including all);
create unlogged table if not exists public.stg_ciclo_estado (like public.ciclo_estado including all);
create unlogged table if not exists public.stg_estado_catalogo (like public.estado_catalogo including all);
create unlogged table if not exists public.stg_usuario_real (like public.usuario_real including all);

-- Los CSV no traen cargado_en: se permite vacío en temporales
alter table public.stg_solicitud alter column cargado_en drop not null;
alter table public.stg_ciclo_estado alter column cargado_en drop not null;

create or replace function public.aplicar_ventana(p_desde date)
returns text
language plpgsql
security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare
  n_sol int; n_cic int; n_borradas int; n_huerfanas int;
begin
  -- 1) Eliminar las solicitudes anteriores a la ventana (solo de los países que llegaron en la carga)
  delete from public.solicitud s
  where s.fecha_creacion < p_desde
    and s.id_pais in (select distinct id_pais from public.stg_solicitud);
  get diagnostics n_borradas = row_count;

  -- 2) Solicitudes de la ventana: insertar o actualizar
  insert into public.solicitud (
    id_pais, solicitud, cliente, tipo_solicitud, promotor, sucursal, etapa_bitacora, registros_bitacora,
    fecha_creacion, creacion_posterior_a_primer_mov, fecha_primer_mov, fecha_ultimo_mov, fecha_fin_ciclo,
    estado_final, resultado_final, es_abierta, dias_sin_movimiento, registros_solicitud, estados_visitados,
    estados_repetidos, leadtime_horas, leadtime_habil_horas, leadtime_habil_formalizado, fecha_aprob_informa,
    usuario_crea, solicitudes_cliente, cliente_reprocesado)
  select id_pais, solicitud, null, tipo_solicitud, promotor, sucursal, etapa_bitacora, registros_bitacora,
    fecha_creacion, creacion_posterior_a_primer_mov, fecha_primer_mov, fecha_ultimo_mov, fecha_fin_ciclo,
    estado_final, resultado_final, es_abierta, dias_sin_movimiento, registros_solicitud, estados_visitados,
    estados_repetidos, leadtime_horas, leadtime_habil_horas, leadtime_habil_formalizado,
    fecha_aprob_informa, usuario_crea, solicitudes_cliente, cliente_reprocesado
  from public.stg_solicitud
  on conflict (id_pais, solicitud) do update set
    tipo_solicitud = excluded.tipo_solicitud, promotor = excluded.promotor, sucursal = excluded.sucursal,
    etapa_bitacora = excluded.etapa_bitacora, registros_bitacora = excluded.registros_bitacora,
    fecha_creacion = excluded.fecha_creacion, creacion_posterior_a_primer_mov = excluded.creacion_posterior_a_primer_mov,
    fecha_primer_mov = excluded.fecha_primer_mov, fecha_ultimo_mov = excluded.fecha_ultimo_mov,
    fecha_fin_ciclo = excluded.fecha_fin_ciclo, estado_final = excluded.estado_final,
    resultado_final = excluded.resultado_final, es_abierta = excluded.es_abierta,
    dias_sin_movimiento = excluded.dias_sin_movimiento, registros_solicitud = excluded.registros_solicitud,
    estados_visitados = excluded.estados_visitados, estados_repetidos = excluded.estados_repetidos,
    leadtime_horas = excluded.leadtime_horas, leadtime_habil_horas = excluded.leadtime_habil_horas,
    leadtime_habil_formalizado = excluded.leadtime_habil_formalizado, fecha_aprob_informa = excluded.fecha_aprob_informa,
    usuario_crea = excluded.usuario_crea, solicitudes_cliente = excluded.solicitudes_cliente,
    cliente_reprocesado = excluded.cliente_reprocesado, cargado_en = now();
  get diagnostics n_sol = row_count;

  -- 3) Movimientos de la ventana: insertar o actualizar
  insert into public.ciclo_estado (
    id_pais, solicitud, id_movimiento, orden_estado, id_estado, estado, id_estado_destino, estado_destino,
    clase_estado, fecha_hora, fecha_salida, fecha_fin_efectiva, id_usuario_modifica, usuario_modifica,
    antes_formalizado, post_corte, horas_habiles, horas_estado)
  select id_pais, solicitud, id_movimiento, orden_estado, id_estado, estado, id_estado_destino, estado_destino,
    clase_estado, fecha_hora, fecha_salida, fecha_fin_efectiva, id_usuario_modifica, usuario_modifica,
    antes_formalizado, post_corte, horas_habiles, horas_estado
  from public.stg_ciclo_estado
  on conflict (id_pais, solicitud, id_movimiento) do update set
    orden_estado = excluded.orden_estado, id_estado = excluded.id_estado, estado = excluded.estado,
    id_estado_destino = excluded.id_estado_destino, estado_destino = excluded.estado_destino,
    clase_estado = excluded.clase_estado, fecha_hora = excluded.fecha_hora, fecha_salida = excluded.fecha_salida,
    fecha_fin_efectiva = excluded.fecha_fin_efectiva, id_usuario_modifica = excluded.id_usuario_modifica,
    usuario_modifica = excluded.usuario_modifica, antes_formalizado = excluded.antes_formalizado,
    post_corte = excluded.post_corte, horas_habiles = excluded.horas_habiles, horas_estado = excluded.horas_estado,
    cargado_en = now();
  get diagnostics n_cic = row_count;

  -- 4) Quitar movimientos que quedaron sin solicitud (de las solicitudes eliminadas en el paso 1)
  delete from public.ciclo_estado c
  where c.id_pais in (select distinct id_pais from public.stg_solicitud)
    and not exists (select 1 from public.solicitud s where s.id_pais = c.id_pais and s.solicitud = c.solicitud);
  get diagnostics n_huerfanas = row_count;

  -- 5) Catálogos (estados y usuarios): reemplazo completo de los países cargados
  delete from public.estado_catalogo where id_pais in (select distinct id_pais from public.stg_estado_catalogo);
  insert into public.estado_catalogo select * from public.stg_estado_catalogo
  on conflict (id_pais, id_estado) do update set nombre = excluded.nombre;
  delete from public.usuario_real where id_pais in (select distinct id_pais from public.stg_usuario_real);
  insert into public.usuario_real select * from public.stg_usuario_real
  on conflict (id_pais, id_usuario) do update set nombre = excluded.nombre;

  -- 6) Vaciar las temporales y actualizar estadísticas
  truncate public.stg_solicitud, public.stg_ciclo_estado, public.stg_estado_catalogo, public.stg_usuario_real;
  analyze public.solicitud;
  analyze public.ciclo_estado;

  return format('Ventana desde %s: solicitudes borradas=%s, actualizadas/insertadas=%s, movimientos=%s, movimientos huérfanos eliminados=%s',
    p_desde, n_borradas, n_sol, n_cic, n_huerfanas);
end;
$$;

revoke execute on function public.aplicar_ventana(date) from anon, authenticated;

-- PASO 1 (antes de cargar): libera el espacio del mes que sale de la ventana.
-- Borra solicitudes anteriores a p_desde y sus movimientos, en todos los países.
create or replace function public.liberar_mes_antiguo(p_desde date)
returns text
language plpgsql
security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare n_sol int; n_cic int;
begin
  delete from public.ciclo_estado c
  using public.solicitud s
  where s.id_pais = c.id_pais and s.solicitud = c.solicitud and s.fecha_creacion < p_desde;
  get diagnostics n_cic = row_count;
  delete from public.solicitud where fecha_creacion < p_desde;
  get diagnostics n_sol = row_count;
  delete from public.resumen_mensual where mes < date_trunc('month', p_desde)::date;
  return format('Liberado antes de %s: solicitudes=%s, movimientos=%s', p_desde, n_sol, n_cic);
end;
$$;
revoke execute on function public.liberar_mes_antiguo(date) from anon, authenticated;
