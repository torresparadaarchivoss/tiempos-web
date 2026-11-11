"""Extrae del DWH (solo lectura) el detalle de los últimos 3 meses y lo deja en CSV para \copy.
NO incluye nombres de clientes. Los archivos quedan FUERA del repositorio.
Uso: python -I extraer_csv_3m.py <proyecto_streamlit> <carpeta_salida> <desde YYYY-MM-DD>
"""
import os, sys, time
import pandas as pd

sys.path.insert(0, sys.argv[1])
from core import config as C, data, db  # noqa: E402

OUT, DESDE = sys.argv[2], pd.Timestamp(sys.argv[3]).date()
os.makedirs(OUT, exist_ok=True)
# (id en el DWH, id en Supabase, nombre)
PAISES = [(1, 1, "Costa Rica"), (2, 3, "Nicaragua"), (3, 2, "Panamá"), (4, 4, "El Salvador")]
sql_lote = open(C.ROOT / "sql" / "carga_tiempos.sql", encoding="utf-8").read()

COLS_CICLO = ["id_pais", "solicitud", "id_movimiento", "orden_estado", "id_estado", "estado", "id_estado_destino",
              "estado_destino", "clase_estado", "fecha_hora", "fecha_salida", "fecha_fin_efectiva",
              "id_usuario_modifica", "usuario_modifica", "antes_formalizado", "post_corte", "horas_habiles", "horas_estado"]
COLS_SOL = ["id_pais", "solicitud", "tipo_solicitud", "promotor", "sucursal", "etapa_bitacora", "registros_bitacora",
            "fecha_creacion", "creacion_posterior_a_primer_mov", "fecha_primer_mov", "fecha_ultimo_mov", "fecha_fin_ciclo",
            "estado_final", "resultado_final", "es_abierta", "dias_sin_movimiento", "registros_solicitud",
            "estados_visitados", "estados_repetidos", "leadtime_horas", "leadtime_habil_horas",
            "leadtime_habil_formalizado", "fecha_aprob_informa", "usuario_crea", "solicitudes_cliente", "cliente_reprocesado"]

for id_dwh, id_sb, nombre in PAISES:
    t0 = time.time()
    ciclo, sol, est, usu = db.read_sets(sql_lote, (id_dwh, DESDE, C.ESTADO_CORTE.upper()))
    # ciclo: columnas del lote -> tabla
    c = ciclo.rename(columns={c_: c_.lower() for c_ in ciclo.columns})
    # el lote no trae nombres en el ciclo: se reponen con los catálogos (igual que core/data.py)
    nombre_estado = dict(zip(est["ID_ESTADO"], est["ESTADO"]))
    c["estado"] = c["id_estado"].map(nombre_estado)
    c["estado_destino"] = c["id_estado_destino"].map(nombre_estado)
    usu_ok = usu[usu["ID_USUARIO"].notna()]
    nombre_usu = dict(zip(usu_ok["ID_USUARIO"], usu_ok["USUARIO"]))
    c["usuario_modifica"] = c["id_usuario_modifica"].map(nombre_usu)
    c["id_pais"] = id_sb
    c["antes_formalizado"] = c["antes_formalizado"].astype(int)
    c["post_corte"] = c["post_corte"].astype(int)
    for col in ["id_pais", "solicitud", "id_movimiento", "orden_estado", "id_estado", "id_estado_destino", "id_usuario_modifica", "antes_formalizado", "post_corte"]:
        c[col] = pd.to_numeric(c[col], errors="coerce").astype("Int64")
    c[COLS_CICLO].to_csv(os.path.join(OUT, f"ciclo_pais{id_sb}.csv"), index=False, na_rep="")
    # solicitud: se omite cliente (dato personal de cliente, fuera de alcance)
    s = sol.rename(columns={c_: c_.lower() for c_ in sol.columns})
    s["id_pais"] = id_sb
    s["creacion_posterior_a_primer_mov"] = 0
    for col in ["id_pais", "solicitud", "registros_bitacora", "creacion_posterior_a_primer_mov", "es_abierta", "dias_sin_movimiento", "registros_solicitud", "estados_visitados", "estados_repetidos", "solicitudes_cliente", "cliente_reprocesado"]:
        s[col] = pd.to_numeric(s[col], errors="coerce").astype("Int64")
    s[COLS_SOL].to_csv(os.path.join(OUT, f"solicitud_pais{id_sb}.csv"), index=False, na_rep="")
    # catálogos
    e = est.rename(columns={c_: c_.lower() for c_ in est.columns})
    e["id_pais"] = id_sb
    e[["id_pais", "id_estado", "estado"]].rename(columns={"estado": "nombre"}).to_csv(
        os.path.join(OUT, f"estado_pais{id_sb}.csv"), index=False, na_rep="")
    u = usu.rename(columns={c_: c_.lower() for c_ in usu.columns})
    u = u[u["id_usuario"].notna()].copy()
    u["id_pais"] = id_sb
    u[["id_pais", "id_usuario", "usuario"]].rename(columns={"usuario": "nombre"}).drop_duplicates(
        subset=["id_pais", "id_usuario"]).to_csv(os.path.join(OUT, f"usuario_pais{id_sb}.csv"), index=False, na_rep="")
    print(f"{nombre:12} movimientos={len(c):8} solicitudes={len(s):7} estados={len(e):3} usuarios={len(u):5} "
          f"({time.time() - t0:.0f}s)", flush=True)
print("OK ->", OUT)
