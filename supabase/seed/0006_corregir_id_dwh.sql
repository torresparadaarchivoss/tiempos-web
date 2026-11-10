-- 0006_corregir_id_dwh.sql
-- Corrige el id del país en el DWH según dwh.bitAtenccion.dim_pais (verificado el 2026-11-10):
--   1 = Costa Rica, 2 = Nicaragua, 3 = Panamá, 4 = El Salvador
-- Los id internos de Supabase (pais.id_pais) NO cambian; solo id_pais_dwh.

update public.pais set id_pais_dwh = case codigo
    when 'CR' then 1
    when 'NI' then 2
    when 'PA' then 3
    when 'SV' then 4
end, actualizado_en = now();

-- Verificación
select id_pais, codigo, nombre, id_pais_dwh from public.pais order by id_pais;
