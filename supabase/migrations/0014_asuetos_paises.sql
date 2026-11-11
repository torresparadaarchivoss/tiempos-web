-- 0014_asuetos_paises.sql
-- Asuetos 2026 de Costa Rica (1), Nicaragua (3) y Panamá (2), según fuentes públicas (búsqueda 2026-11-11).
-- DUDOSOS, NO incluidos (confirmar en Gaceta/MTSS antes de usar en producción):
--   CR: 1 de diciembre (abolición del ejército: fuentes contradictorias sobre su pago)
--   PA: Jueves Santo 2 abr, 4-5 nov, 20 dic
--   NI: 18 enero (natalicio de Rubén Darío), 19 julio (Día de la Revolución)
-- Los valores de ids: pais.id_pais (1 CR, 2 PA, 3 NI, 4 SV).

insert into public.asueto (id_pais, fecha, descripcion) values
  -- Costa Rica
  (1, '2026-01-01', 'Año nuevo'),
  (1, '2026-04-02', 'Jueves santo'),
  (1, '2026-04-03', 'Viernes santo'),
  (1, '2026-04-11', 'Día de Juan Santamaría'),
  (1, '2026-05-01', 'Día del trabajador'),
  (1, '2026-07-25', 'Anexión del Partido de Nicoya'),
  (1, '2026-08-15', 'Día de la madre'),
  (1, '2026-09-15', 'Independencia'),
  (1, '2026-12-25', 'Navidad'),
  -- Panamá
  (2, '2026-01-01', 'Año nuevo'),
  (2, '2026-01-09', 'Día de los mártires'),
  (2, '2026-02-17', 'Martes de carnaval'),
  (2, '2026-04-03', 'Viernes santo'),
  (2, '2026-05-01', 'Día del trabajo'),
  (2, '2026-11-03', 'Separación de Colombia'),
  (2, '2026-11-10', 'Primer grito de independencia'),
  (2, '2026-11-28', 'Independencia'),
  (2, '2026-12-08', 'Día de las madres'),
  (2, '2026-12-25', 'Navidad'),
  -- Nicaragua
  (3, '2026-01-01', 'Año nuevo'),
  (3, '2026-04-02', 'Jueves santo'),
  (3, '2026-04-03', 'Viernes santo'),
  (3, '2026-05-01', 'Día del trabajador'),
  (3, '2026-09-14', 'Batalla de San Jacinto'),
  (3, '2026-09-15', 'Día de la independencia'),
  (3, '2026-12-25', 'Navidad')
on conflict (id_pais, fecha) do nothing;
