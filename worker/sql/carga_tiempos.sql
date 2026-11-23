/* CARGA_TIEMPOS: un solo lote, una sola conexión, cuatro resultados.
     1) ciclo       una fila por cambio real de estado (delgada: ids en vez de nombres)
     2) solicitudes una fila por solicitud
     3) estados     ID_ESTADO -> ESTADO       (solo los presentes en el ciclo)
     4) usuarios    ID_USUARIO -> nombre      (solo los presentes en el ciclo)
   SQL Server 2016+ (DROP TABLE IF EXISTS), solo lectura sobre el DWH; escribe únicamente en tempdb.

   Por qué así (rendimiento, medido 2026-11-10):
   - La lógica hist→c se calcula UNA vez y se materializa en #c. Antes cada consulta la recalculaba
     y fact_solicitudes la evaluaba varias veces (CTE no materializada): 3 lecturas del histórico.
   - El ciclo viaja con ids: los nombres repetidos eran ~40% de los bytes y el cuello es la red
     (ASYNC_NETWORK_IO). Los nombres se reponen en pandas con los resultados 3 y 4.
   - Parámetros vía ? (pyodbc) asignados a variables locales: el optimizador estima por densidad,
     igual que antes. No usar OPTION (RECOMPILE) aquí: con el valor real el plan de la vista de
     bitácora se degradó a >10 min en las pruebas.
   - La base tiene READ_COMMITTED_SNAPSHOT: las lecturas no bloquean la carga del ETL (no usar NOLOCK).

   Ejecutar en SSMS: reemplazar los tres ? del DECLARE, p. ej. 4, '20260101', 'FORMALIZADO'. */
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET DEADLOCK_PRIORITY LOW;   -- si alguna vez choca con el ETL, que pierda el dashboard
DECLARE @IdPais INT = ?, @FechaDesde DATE = ?, @EstadoCorte VARCHAR(100) = ?, @Ahora DATETIME2(0) = SYSDATETIME();

DROP TABLE IF EXISTS #cal, #c, #cor;

/* ---------- Calendario laboral: un día por fila ---------- */
;WITH
asuetos (FECHA) AS (   -- único lugar donde se mantienen los asuetos (y core/config.py ASUETOS)
    SELECT CAST(v AS DATE) FROM (VALUES
        ('20260101'),('20260402'),('20260403'),('20260404'),('20260405'),('20260501'),
        ('20260510'),('20260617'),('20260805'),('20260806'),('20260915'),('20261102'),('20261225')
    ) a (v)
)
SELECT t.DIA, t.INI_LAB, t.SEG,   -- SEG = segundos laborables del día; ACUM = acumulados antes del día
       SUM(t.SEG) OVER (ORDER BY t.DIA ROWS UNBOUNDED PRECEDING) - t.SEG AS ACUM
INTO #cal
FROM (
    SELECT d.DIA,
           DATEADD(HOUR, 8, CAST(d.DIA AS DATETIME2(0))) AS INI_LAB,
           CASE WHEN d.SEM = 6 OR a.FECHA IS NOT NULL THEN 0   -- domingo o asueto
                WHEN d.SEM = 5 THEN 14400                       -- sábado 8-12
                ELSE 32400 END AS SEG                           -- lunes a viernes 8-17
    FROM (
        SELECT DATEADD(DAY, k.n, @FechaDesde) AS DIA,
               DATEDIFF(DAY, '19000101', DATEADD(DAY, k.n, @FechaDesde)) % 7 AS SEM   -- 0 = lunes
        FROM (SELECT TOP (1500) CAST(ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS INT) AS n
              FROM sys.all_objects o1 CROSS JOIN sys.all_objects o2) k
    ) d
    LEFT JOIN asuetos a ON a.FECHA = d.DIA
) t;
CREATE UNIQUE CLUSTERED INDEX cx_cal ON #cal (DIA);

/* ---------- Ciclo de estados: se lee el DWH una sola vez ---------- */
;WITH
hist AS (
    SELECT MS.id_m_solicitud AS SOLICITUD, MS.id_his_m_solicitud AS ID_MOVIMIENTO,
           MS.his_msol_estado AS ID_ESTADO,
           COALESCE(E.nombre_estado, CONCAT('SIN NOMBRE ', MS.his_msol_estado)) AS ESTADO,
           MS.his_msol_fecha_modifica AS FECHA_HORA,
           MS.his_msol_usuario_modifica AS ID_USUARIO_MODIFICA,
           LTRIM(RTRIM(CONCAT(U.usu_nombre, ' ', U.usu_apellido1, ' ', U.usu_apellido2))) AS USUARIO_MODIFICA
    FROM dwh.hech_maestro_solicitud HMS
    JOIN dwh.hech_historico_maestro_solicitud MS
      ON MS.id_m_solicitud = HMS.id_m_solicitud AND MS.id_pais = HMS.id_pais
    LEFT JOIN dwh.dim_estado_solicitud E ON E.id_estado = MS.his_msol_estado AND E.id_pais = MS.id_pais
    LEFT JOIN dwh.dim_t_usuario U ON U.id_usuario = MS.his_msol_usuario_modifica AND U.id_pais = MS.id_pais
    WHERE HMS.id_pais = @IdPais AND HMS.msol_fecha_crea >= @FechaDesde AND MS.his_msol_estado IS NOT NULL
),
p AS (
    SELECT h.*, LAG(h.ESTADO) OVER (PARTITION BY h.SOLICITUD ORDER BY h.FECHA_HORA, h.ID_MOVIMIENTO) AS PREV
    FROM hist h
),
t AS (   -- solo cambios reales; las ventanas son idénticas, así que se ordena una sola vez
    SELECT p.*,
           ROW_NUMBER()       OVER (PARTITION BY p.SOLICITUD ORDER BY p.FECHA_HORA, p.ID_MOVIMIENTO) AS ORDEN_ESTADO,
           LEAD(p.ESTADO)     OVER (PARTITION BY p.SOLICITUD ORDER BY p.FECHA_HORA, p.ID_MOVIMIENTO) AS ESTADO_DESTINO,
           LEAD(p.ID_ESTADO)  OVER (PARTITION BY p.SOLICITUD ORDER BY p.FECHA_HORA, p.ID_MOVIMIENTO) AS ID_ESTADO_DESTINO,
           LEAD(p.FECHA_HORA) OVER (PARTITION BY p.SOLICITUD ORDER BY p.FECHA_HORA, p.ID_MOVIMIENTO) AS FECHA_SALIDA
    FROM p
    WHERE p.PREV IS NULL OR p.ESTADO <> p.PREV
)
SELECT t.SOLICITUD, t.ID_MOVIMIENTO, t.ID_ESTADO, t.ESTADO, t.FECHA_HORA, t.ID_USUARIO_MODIFICA, t.USUARIO_MODIFICA,
       CAST(t.ORDEN_ESTADO AS INT) AS ORDEN_ESTADO, t.ESTADO_DESTINO, t.ID_ESTADO_DESTINO, t.FECHA_SALIDA, k.CLASE,
       MIN(CASE WHEN k.CLASE = 'EXITOSA' THEN t.ORDEN_ESTADO END) OVER (PARTITION BY t.SOLICITUD) AS ORD_FORM
INTO #c
FROM t
CROSS APPLY (SELECT CASE   -- EXITOSA / RECHAZADA / DESERCION / ABIERTA (única definición de negocio)
    WHEN UPPER(t.ESTADO) IN ('FORMALIZADO','EXPEDIENTE COMPLETO','EXPEDIENTE INCOMPLETO','AUDITADO') THEN 'EXITOSA'
    WHEN UPPER(t.ESTADO) LIKE '%RECHAZADO%' THEN 'RECHAZADA'
    WHEN UPPER(t.ESTADO) LIKE '%DESIST%'    THEN 'DESERCION'
    WHEN ' ' + REPLACE(REPLACE(REPLACE(UPPER(t.ESTADO), '-', ' '), '_', ' '), '.', ' ') + ' ' LIKE '% TUD %'
                                            THEN 'DESERCION'   -- TUD como palabra (no "SOLICITUD")
    ELSE 'ABIERTA' END AS CLASE) k;
CREATE UNIQUE CLUSTERED INDEX cx_c ON #c (SOLICITUD, ORDEN_ESTADO);

/* Primer ingreso al estado de corte por solicitud: el reloj se detiene ahí */
SELECT c.SOLICITUD, MIN(c.ORDEN_ESTADO) AS ORD_CORTE, MIN(c.FECHA_HORA) AS FECHA_CORTE
INTO #cor
FROM #c c
WHERE UPPER(c.ESTADO) = @EstadoCorte
GROUP BY c.SOLICITUD;
CREATE UNIQUE CLUSTERED INDEX cx_cor ON #cor (SOLICITUD);

/* ---------- Tramos con horas hábiles (base de los resultados 1 y 2) ---------- */
;WITH m AS (
    SELECT c.SOLICITUD, c.ID_MOVIMIENTO, c.ID_ESTADO, c.ID_ESTADO_DESTINO, c.ESTADO, c.ESTADO_DESTINO, c.ORDEN_ESTADO,
           c.CLASE, c.FECHA_HORA, c.FECHA_SALIDA, f.FIN, c.ID_USUARIO_MODIFICA, c.USUARIO_MODIFICA,
           CASE WHEN q.ORD_CORTE IS NOT NULL THEN CASE WHEN c.ORDEN_ESTADO < q.ORD_CORTE THEN 1 ELSE 0 END
                WHEN c.ORD_FORM IS NOT NULL AND c.ORDEN_ESTADO < c.ORD_FORM THEN 1 ELSE 0 END AS ANTES_FORMALIZADO,
           CASE WHEN q.ORD_CORTE IS NOT NULL AND c.ORDEN_ESTADO >= q.ORD_CORTE THEN 1 ELSE 0 END AS POST_CORTE,
           h.SEG_HAB
    FROM #c c
    LEFT JOIN #cor q ON q.SOLICITUD = c.SOLICITUD
    CROSS APPLY (SELECT CASE WHEN c.ESTADO_DESTINO IS NULL AND c.CLASE = 'ABIERTA' AND c.ORDEN_ESTADO > 1 THEN @Ahora
                             ELSE c.FECHA_SALIDA END AS FIN) f   -- un solo estado: sin fin, no se mide
    LEFT JOIN #cal a ON a.DIA = CAST(c.FECHA_HORA AS DATE)
    LEFT JOIN #cal b ON b.DIA = CAST(f.FIN AS DATE)
    CROSS APPLY (SELECT DATEDIFF(SECOND, a.INI_LAB, c.FECHA_HORA) AS D1,
                        DATEDIFF(SECOND, b.INI_LAB, f.FIN)        AS D2) d
    CROSS APPLY (SELECT (b.ACUM + CASE WHEN d.D2 < 0 THEN 0 WHEN d.D2 > b.SEG THEN b.SEG ELSE d.D2 END)
                      - (a.ACUM + CASE WHEN d.D1 < 0 THEN 0 WHEN d.D1 > a.SEG THEN a.SEG ELSE d.D1 END) AS SEG_HAB) h
)
/* ===== Resultado 1: ciclo (delgado) ===== */
SELECT m.SOLICITUD, m.ID_MOVIMIENTO, m.ID_ESTADO, m.ID_ESTADO_DESTINO, m.ORDEN_ESTADO, m.CLASE AS CLASE_ESTADO,
       m.FECHA_HORA, m.FECHA_SALIDA, m.FIN AS FECHA_FIN_EFECTIVA,   -- abierta y último estado: corre hasta @Ahora
       m.ID_USUARIO_MODIFICA,
       CAST(m.ANTES_FORMALIZADO AS TINYINT) AS ANTES_FORMALIZADO, CAST(m.POST_CORTE AS TINYINT) AS POST_CORTE,
       CAST(CASE WHEN m.FIN IS NULL THEN NULL WHEN m.SEG_HAB < 0 THEN 0 ELSE m.SEG_HAB / 3600.0 END AS FLOAT) AS HORAS_HABILES,
       CAST(DATEDIFF(SECOND, m.FECHA_HORA, m.FIN) / 3600.0 AS FLOAT) AS HORAS_ESTADO
FROM m;

/* ===== Resultado 2: solicitudes ===== */
;WITH m AS (   -- mismos tramos; desde #c es barato recalcularlos (no toca el DWH)
    SELECT c.SOLICITUD, c.ESTADO, c.ESTADO_DESTINO, c.FECHA_HORA, c.CLASE, c.ORDEN_ESTADO, c.USUARIO_MODIFICA,
           CASE WHEN q.ORD_CORTE IS NOT NULL THEN CASE WHEN c.ORDEN_ESTADO < q.ORD_CORTE THEN 1 ELSE 0 END
                WHEN c.ORD_FORM IS NOT NULL AND c.ORDEN_ESTADO < c.ORD_FORM THEN 1 ELSE 0 END AS ANTES_FORM,
           CASE WHEN q.ORD_CORTE IS NOT NULL AND c.ORDEN_ESTADO >= q.ORD_CORTE THEN 0   -- posterior al corte: fuera
                WHEN h.SEG_HAB < 0 THEN 0 ELSE h.SEG_HAB END AS SEG
    FROM #c c
    LEFT JOIN #cor q ON q.SOLICITUD = c.SOLICITUD
    CROSS APPLY (SELECT CASE WHEN c.ESTADO_DESTINO IS NULL AND c.CLASE = 'ABIERTA' AND c.ORDEN_ESTADO > 1 THEN @Ahora
                             ELSE c.FECHA_SALIDA END AS FIN) f
    LEFT JOIN #cal a ON a.DIA = CAST(c.FECHA_HORA AS DATE)
    LEFT JOIN #cal b ON b.DIA = CAST(f.FIN AS DATE)
    CROSS APPLY (SELECT DATEDIFF(SECOND, a.INI_LAB, c.FECHA_HORA) AS D1,
                        DATEDIFF(SECOND, b.INI_LAB, f.FIN)        AS D2) d
    CROSS APPLY (SELECT (b.ACUM + CASE WHEN d.D2 < 0 THEN 0 WHEN d.D2 > b.SEG THEN b.SEG ELSE d.D2 END)
                      - (a.ACUM + CASE WHEN d.D1 < 0 THEN 0 WHEN d.D1 > a.SEG THEN a.SEG ELSE d.D1 END) AS SEG_HAB) h
),
s AS (   -- una fila por solicitud
    SELECT m.SOLICITUD,
           MIN(m.FECHA_HORA)        AS FECHA_PRIMER_MOV,
           MAX(m.FECHA_HORA)        AS FECHA_ULTIMO_MOV,
           COUNT(*)                 AS REGISTROS_SOLICITUD,
           COUNT(DISTINCT m.ESTADO) AS ESTADOS_VISITADOS,
           MAX(CASE WHEN m.ESTADO_DESTINO IS NULL THEN m.ESTADO END) AS ESTADO_FINAL,
           MAX(CASE WHEN m.ESTADO_DESTINO IS NULL THEN m.CLASE  END) AS CLASE_FINAL,
           MAX(CASE WHEN m.ORDEN_ESTADO = 1 THEN m.USUARIO_MODIFICA END) AS USUARIO_CREA,   -- usuario del primer movimiento
           SUM(m.SEG) / 3600.0      AS LEADTIME_HABIL_HORAS,
           SUM(CASE WHEN m.ANTES_FORM = 1 THEN m.SEG END) / 3600.0 AS LEADTIME_HABIL_FORMALIZADO
    FROM m
    GROUP BY m.SOLICITUD
),
mae AS (
    SELECT id_m_solicitud AS SOLICITUD, msol_fecha_crea AS FECHA_CREACION_DWH
    FROM dwh.hech_maestro_solicitud
    WHERE id_pais = @IdPais AND msol_fecha_crea >= @FechaDesde
),
bit AS (   -- bitácora sin duplicados: prefiere la fila con promotor informado
    SELECT q.Num_Solicitud, q.Cliente, q.Tipo_Credito, q.Promotor, q.Suc_Origen, q.Categorizacion, q.REGISTROS_BITACORA,
           CASE WHEN q.Cliente IS NULL THEN 1 ELSE COUNT(*) OVER (PARTITION BY q.Cliente) END AS SOLICITUDES_CLIENTE
    FROM (
        SELECT B.Num_Solicitud, B.Cliente, B.Tipo_Credito, B.Promotor, B.Suc_Origen, B.Categorizacion,
               COUNT(*) OVER (PARTITION BY B.Num_Solicitud) AS REGISTROS_BITACORA,
               ROW_NUMBER() OVER (PARTITION BY B.Num_Solicitud
                                  ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(B.Promotor)), '') IS NULL THEN 1 ELSE 0 END,
                                           B.Promotor, B.Cliente) AS RN
        FROM dwh.vista_bitacora_atencion_regional B
        WHERE B.IdPais = @IdPais AND B.Num_Solicitud IN (SELECT SOLICITUD FROM mae)
    ) q
    WHERE q.RN = 1
)
SELECT
    s.SOLICITUD, b.Cliente AS CLIENTE, b.Tipo_Credito AS TIPO_SOLICITUD, b.Promotor AS PROMOTOR,
    b.Suc_Origen AS SUCURSAL, b.Categorizacion AS ETAPA_BITACORA, b.REGISTROS_BITACORA,
    x.CREA AS FECHA_CREACION,   -- msol_fecha_crea si es <= primer movimiento; si no, el primer movimiento
    CASE WHEN mae.FECHA_CREACION_DWH > s.FECHA_PRIMER_MOV THEN 1 ELSE 0 END AS CREACION_POSTERIOR_A_PRIMER_MOV,
    s.FECHA_PRIMER_MOV, s.FECHA_ULTIMO_MOV, x.FIN_CICLO AS FECHA_FIN_CICLO,   -- abierta: corre hasta @Ahora
    s.ESTADO_FINAL,
    CASE WHEN s.CLASE_FINAL <> 'ABIERTA' THEN s.CLASE_FINAL
         WHEN s.ESTADOS_VISITADOS = 1    THEN 'SOLO_UN_ESTADO'
         WHEN y.DSM >= 30                THEN 'ESTANCADA'
         ELSE 'EN_PROCESO' END AS RESULTADO_FINAL,
    CASE WHEN s.CLASE_FINAL = 'ABIERTA' THEN 1 ELSE 0 END AS ES_ABIERTA,
    CASE WHEN s.CLASE_FINAL = 'ABIERTA' AND s.ESTADOS_VISITADOS > 1 THEN y.DSM END AS DIAS_SIN_MOVIMIENTO,   -- un solo estado: no se mide
    s.REGISTROS_SOLICITUD, s.ESTADOS_VISITADOS,
    s.REGISTROS_SOLICITUD - s.ESTADOS_VISITADOS AS ESTADOS_REPETIDOS,
    DATEDIFF(SECOND, s.FECHA_PRIMER_MOV, x.FIN_CICLO) / 3600.0 AS LEADTIME_HORAS,
    s.LEADTIME_HABIL_HORAS,
    CASE WHEN s.CLASE_FINAL = 'EXITOSA' THEN s.LEADTIME_HABIL_FORMALIZADO END AS LEADTIME_HABIL_FORMALIZADO,
    q.FECHA_CORTE AS FECHA_APROB_INFORMA,
    s.USUARIO_CREA,
    b.SOLICITUDES_CLIENTE, CASE WHEN b.SOLICITUDES_CLIENTE > 1 THEN 1 ELSE 0 END AS CLIENTE_REPROCESADO
FROM s
JOIN mae ON mae.SOLICITUD = s.SOLICITUD
LEFT JOIN bit b ON b.Num_Solicitud = s.SOLICITUD
LEFT JOIN #cor q ON q.SOLICITUD = s.SOLICITUD
CROSS APPLY (SELECT CASE WHEN mae.FECHA_CREACION_DWH <= s.FECHA_PRIMER_MOV THEN mae.FECHA_CREACION_DWH
                         ELSE s.FECHA_PRIMER_MOV END AS CREA,
                    CASE WHEN s.CLASE_FINAL <> 'ABIERTA' THEN s.FECHA_ULTIMO_MOV
                         WHEN s.ESTADOS_VISITADOS > 1     THEN @Ahora END AS FIN_CICLO) x   -- un solo estado: NULL
CROSS APPLY (SELECT DATEDIFF(SECOND, s.FECHA_ULTIMO_MOV, @Ahora) / 86400 AS DSM) y;

/* ===== Resultados 3 y 4: diccionarios para reponer los nombres del ciclo ===== */
SELECT DISTINCT ID_ESTADO, ESTADO FROM #c;
SELECT DISTINCT ID_USUARIO_MODIFICA AS ID_USUARIO, USUARIO_MODIFICA AS USUARIO FROM #c;

DROP TABLE IF EXISTS #cal, #c, #cor;   -- liberar tempdb sin esperar al cierre de la conexión
