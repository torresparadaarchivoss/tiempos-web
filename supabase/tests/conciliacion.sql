-- Conciliación solicitud vs resumen_mensual. Devuelve filas SOLO si hay diferencias.

-- 1) Por país y mes: solicitudes creadas en solicitud vs suma de creadas en resumen_mensual
with desde_solicitud as (
    select id_pais,
           date_trunc('month', fecha_creacion)::date as mes,
           count(*) as creadas_solicitud
    from public.solicitud
    where fecha_creacion is not null
    group by 1, 2
),
desde_resumen as (
    select id_pais, mes, sum(creadas) as creadas_resumen
    from public.resumen_mensual
    group by 1, 2
)
select coalesce(s.id_pais, r.id_pais)        as id_pais,
       coalesce(s.mes, r.mes)                as mes,
       coalesce(s.creadas_solicitud, 0)      as creadas_solicitud,
       coalesce(r.creadas_resumen, 0)        as creadas_resumen,
       coalesce(s.creadas_solicitud, 0)
         - coalesce(r.creadas_resumen, 0)    as diferencia
from desde_solicitud s
full join desde_resumen r
       on r.id_pais = s.id_pais and r.mes = s.mes
where coalesce(s.creadas_solicitud, 0) <> coalesce(r.creadas_resumen, 0)
order by id_pais, mes;

-- 2) Rangos de horas hábiles deben sumar formalizadas en resumen_mensual
select id_pais, mes, tipo_solicitud, resultado_final,
       formalizadas,
       hasta_8_hh + de_8_a_16_hh + de_16_a_24_hh + mas_de_24_hh as suma_rangos,
       (hasta_8_hh + de_8_a_16_hh + de_16_a_24_hh + mas_de_24_hh) - formalizadas as diferencia
from public.resumen_mensual
where hasta_8_hh + de_8_a_16_hh + de_16_a_24_hh + mas_de_24_hh <> formalizadas
order by id_pais, mes;
