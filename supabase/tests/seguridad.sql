-- Chequeos de seguridad. Cada consulta devuelve filas SOLO si hay un problema.
-- Ejecutar en el SQL Editor de Supabase. Sin filas = todo OK.

-- (a) Tablas de public sin RLS
select schemaname, tablename
from pg_tables
where schemaname = 'public' and rowsecurity = false;

-- (b) Funciones SECURITY DEFINER en public ejecutables por anon o authenticated.
-- Ninguna función de 0001-0023 debe ser pública: todas van a authenticated.
-- Las helpers es_super_admin / paises_del_usuario / es_admin_de_pais aparecen si
-- siguen con el EXECUTE por defecto de PUBLIC; conviene revocarlo a anon.
-- Agregar aquí, si hiciera falta, funciones que deban ser públicas:
--   and p.proname not in ('nombre_funcion_publica')
select p.oid::regprocedure as funcion,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as ejecutable_anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as ejecutable_authenticated
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- (c) Tablas de public con privilegios para anon
select c.relname as tabla,
       has_table_privilege('anon', c.oid, 'SELECT')   as select_anon,
       has_table_privilege('anon', c.oid, 'INSERT')   as insert_anon,
       has_table_privilege('anon', c.oid, 'UPDATE')   as update_anon,
       has_table_privilege('anon', c.oid, 'DELETE')   as delete_anon
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p', 'v', 'm')
  and (has_table_privilege('anon', c.oid, 'SELECT')
       or has_table_privilege('anon', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE'));
