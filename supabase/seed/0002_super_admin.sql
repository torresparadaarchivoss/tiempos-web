-- 0002_super_admin.sql
-- Asigna el super administrador (acceso a todos los países).
--
-- ANTES de ejecutar:
--   1) Supabase -> Authentication -> Users -> "Add user" -> "Create new user"
--      Correo: torresparada.archivoss@gmail.com  (con contraseña y "Auto Confirm User" activado)
--   2) Haber ejecutado 0001_esquema_base.sql
--
-- Es seguro ejecutarlo más de una vez (on conflict do nothing / do update).

-- Paso 1: perfil del usuario (buscado por correo en auth.users)
insert into public.perfil (user_id, nombre, es_admin, activo)
select u.id, 'Super administrador', true, true
from auth.users u
where u.email = 'torresparada.archivoss@gmail.com'
on conflict (user_id) do update
    set es_admin = true, activo = true, actualizado_en = now();

-- Paso 2: acceso a todos los países, con administración de parámetros en cada uno
insert into public.acceso_pais (user_id, id_pais, es_admin_pais)
select p.user_id, c.id_pais, true
from public.perfil p
cross join public.pais c
where p.user_id = (select id from auth.users where email = 'torresparada.archivoss@gmail.com')
on conflict (user_id, id_pais) do update
    set es_admin_pais = true;

-- Verificación: debe mostrar los 4 países (CR, PA, NI, SV) para el correo indicado
select u.email, c.codigo, c.nombre
from public.acceso_pais a
join auth.users u on u.id = a.user_id
join public.pais c on c.id_pais = a.id_pais
where u.email = 'torresparada.archivoss@gmail.com'
order by c.id_pais;
