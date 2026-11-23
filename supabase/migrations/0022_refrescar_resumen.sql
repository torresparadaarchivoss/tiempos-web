-- 0022_refrescar_resumen.sql
-- Reconstruye resumen_mensual de UN país desde solicitud, para que la página resumen y el comparativo
-- muestren las mismas cifras que la carga. Lo llama el worker después de aplicar_ventana.
-- Reglas (las mismas de las semillas 0005/0007/0008):
--   creadas        = solicitudes por mes de creación, tipo y resultado_final
--   formalizadas   = resultado_final = 'EXITOSA'
--   suma_hh        = suma de leadtime_habil_formalizado de las formalizadas
--   dentro_sla     = formalizadas con <= 24 HH hábiles
--   rangos         = <= 8, (8,16], (16,24], > 24 HH hábiles (suman formalizadas)
-- Solo agregados: no guarda personas, clientes ni números de solicitud.

create or replace function public.refrescar_resumen(p_pais smallint)
returns text
language plpgsql
security definer
set search_path = public
set statement_timeout = '600s'
as $$
declare n_filas int;
begin
  delete from public.resumen_mensual where id_pais = p_pais;

  insert into public.resumen_mensual (
    id_pais, mes, tipo_solicitud, resultado_final, creadas, formalizadas, suma_hh_formalizado,
    dentro_sla, hasta_8_hh, de_8_a_16_hh, de_16_a_24_hh, mas_de_24_hh, actualizado_en)
  select
    s.id_pais,
    date_trunc('month', s.fecha_creacion)::date,
    coalesce(s.tipo_solicitud, ''),
    coalesce(s.resultado_final, 'EN_PROCESO'),
    count(*),
    count(*) filter (where s.resultado_final = 'EXITOSA'),
    coalesce(sum(s.leadtime_habil_formalizado) filter (where s.resultado_final = 'EXITOSA'), 0),
    count(*) filter (where s.resultado_final = 'EXITOSA' and s.leadtime_habil_formalizado <= 24),
    count(*) filter (where s.resultado_final = 'EXITOSA' and s.leadtime_habil_formalizado <= 8),
    count(*) filter (where s.resultado_final = 'EXITOSA' and s.leadtime_habil_formalizado > 8 and s.leadtime_habil_formalizado <= 16),
    count(*) filter (where s.resultado_final = 'EXITOSA' and s.leadtime_habil_formalizado > 16 and s.leadtime_habil_formalizado <= 24),
    count(*) filter (where s.resultado_final = 'EXITOSA' and s.leadtime_habil_formalizado > 24),
    now()
  from public.solicitud s
  where s.id_pais = p_pais and s.fecha_creacion is not null
  group by 1, 2, 3, 4;
  get diagnostics n_filas = row_count;

  return format('Resumen del país %s recalculado: %s filas', p_pais, n_filas);
end;
$$;

revoke execute on function public.refrescar_resumen(smallint) from anon, authenticated;
