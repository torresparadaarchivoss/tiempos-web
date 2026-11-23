-- Tamaño de la base y de las 10 tablas más grandes de public (límite 500 MB).

-- Tamaño total de la base
select current_database() as base,
       pg_size_pretty(pg_database_size(current_database())) as tamano_total,
       pg_database_size(current_database()) as bytes_total;

-- Top 10 tablas por tamaño total (datos + índices + TOAST)
select c.relname as tabla,
       pg_size_pretty(pg_total_relation_size(c.oid)) as tamano_total,
       pg_size_pretty(pg_relation_size(c.oid))       as tamano_datos,
       pg_size_pretty(pg_indexes_size(c.oid))        as tamano_indices,
       pg_total_relation_size(c.oid)                 as bytes_total
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'm')
order by pg_total_relation_size(c.oid) desc
limit 10;
