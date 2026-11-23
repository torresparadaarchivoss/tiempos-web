"""Actualiza Tiempos (tiempos_web) desde el DWH con ventana móvil.

Flujo: DWH (solo lectura, consulta worker/sql/carga_tiempos.sql) -> tablas stg_* de Supabase -> aplicar_ventana().
La limpieza de meses la hace la base (migración 0018). Se carga país por país para que la tabla de paso no
ocupe el espacio de todos los países a la vez. Las credenciales NO están en este archivo: se leen del
Administrador de credenciales de Windows por el nombre indicado en config.toml.

Uso:
  python worker/actualizar_tiempos.py            carga real
  python worker/actualizar_tiempos.py --simular  trae del DWH y muestra conteos, sin escribir en Supabase
"""
from __future__ import annotations

import argparse
import io
import logging
import tomllib
from datetime import date
from pathlib import Path

import pandas as pd
import psycopg
import pyodbc
import win32cred

RAIZ = Path(__file__).resolve().parent
ESTADO_CORTE = "FORMALIZADO"
MESES = 3
# (id en el DWH, id en Supabase, meses de ventana).
# Costa Rica solo guarda el mes en curso por límite de espacio del plan gratuito (500 MB).
PAISES = [(1, 1, 1), (2, 3, MESES), (3, 2, MESES), (4, 4, MESES)]
TABLAS = ["stg_ciclo_estado", "stg_solicitud", "stg_estado_catalogo", "stg_usuario_real"]
ENTEROS = ("integer", "bigint", "smallint")

log = logging.getLogger("tiempos")


def credencial(nombre: str) -> tuple[str, str]:
    """Usuario y contraseña de una credencial genérica del Administrador de credenciales de Windows."""
    c = win32cred.CredRead(TargetName=nombre, Type=win32cred.CRED_TYPE_GENERIC)
    blob = c["CredentialBlob"]
    try:
        clave = blob.decode("utf-16-le")
    except UnicodeDecodeError:
        clave = blob.decode("utf-8")
    return c["UserName"], clave


def inicio_ventana(hoy: date, meses: int = MESES) -> date:
    """Primer día del mes más antiguo de la ventana: el mes en curso y los meses-1 anteriores."""
    anio, mes = hoy.year, hoy.month - (meses - 1)
    while mes <= 0:
        mes += 12
        anio -= 1
    return date(anio, mes, 1)


def leer_dwh(cfg: dict, id_dwh: int, desde: date) -> tuple[pd.DataFrame, ...]:
    """Ejecuta la consulta del lote y devuelve sus cuatro conjuntos: ciclo, solicitudes, estados y usuarios."""
    usuario, clave = credencial(cfg["credencial"])
    cadena = (f"DRIVER={{{cfg['driver']}}};SERVER={cfg['server']};DATABASE={cfg['database']};"
              f"Encrypt=yes;TrustServerCertificate=yes;UID={usuario};PWD={clave};")
    sql = (RAIZ / "sql" / "carga_tiempos.sql").read_text(encoding="utf-8-sig")
    with pyodbc.connect(cadena, timeout=30) as cn:
        cur = cn.cursor()
        cur.execute(sql, (id_dwh, desde, ESTADO_CORTE))
        conjuntos = []
        while True:
            if cur.description:
                cols = [c[0] for c in cur.description]
                conjuntos.append(pd.DataFrame.from_records(cur.fetchall(), columns=cols))
            if not cur.nextset():
                break
    if len(conjuntos) != 4:
        raise RuntimeError(f"La consulta devolvió {len(conjuntos)} conjuntos; se esperaban 4")
    return tuple(conjuntos)


def transformar(ciclo: pd.DataFrame, sol: pd.DataFrame, est: pd.DataFrame, usu: pd.DataFrame, id_sb: int) -> dict:
    """Arma las cuatro tablas de paso para un país. Los nombres salen de los catálogos del propio DWH."""
    nombre_estado = dict(zip(est["ID_ESTADO"], est["ESTADO"]))
    usu_ok = usu[usu["ID_USUARIO"].notna()]
    nombre_usu = dict(zip(usu_ok["ID_USUARIO"], usu_ok["USUARIO"]))

    c = ciclo.rename(columns=str.lower).copy()
    c["estado"] = c["id_estado"].map(nombre_estado)
    c["estado_destino"] = c["id_estado_destino"].map(nombre_estado)
    c["usuario_modifica"] = c["id_usuario_modifica"].map(nombre_usu)
    c["id_pais"] = id_sb

    s = sol.rename(columns=str.lower).drop(columns=["cliente"], errors="ignore")  # dato personal: nunca sale del DWH
    s["id_pais"] = id_sb
    s["creacion_posterior_a_primer_mov"] = 0

    e = pd.DataFrame({"id_pais": id_sb, "id_estado": est["ID_ESTADO"], "nombre": est["ESTADO"]})
    u = pd.DataFrame({"id_pais": id_sb, "id_usuario": usu_ok["ID_USUARIO"], "nombre": usu_ok["USUARIO"]})
    u = u.drop_duplicates(subset=["id_pais", "id_usuario"])

    return {"stg_ciclo_estado": c, "stg_solicitud": s, "stg_estado_catalogo": e, "stg_usuario_real": u}


def cargar_pais(conn: psycopg.Connection, tablas: dict[str, pd.DataFrame], desde: date, id_sb: int) -> tuple[dict, str]:
    """Llena las tablas de paso de un país con COPY y aplica la ventana de ese país."""
    conteos = {}
    with conn.cursor() as cur:
        for tabla in TABLAS:
            df = tablas[tabla]
            cur.execute("select column_name, data_type from information_schema.columns "
                        "where table_schema = 'public' and table_name = %s", (tabla,))
            tipos = dict(cur.fetchall())
            cols = [c for c in df.columns if c in tipos]
            if not cols:
                raise RuntimeError(f"{tabla}: ninguna columna del DWH coincide con la tabla")
            d = df[cols].copy()
            for c in cols:
                if tipos[c] in ENTEROS:
                    d[c] = pd.to_numeric(d[c], errors="coerce").astype("Int64")
            cur.execute(f"truncate public.{tabla}")
            buf = io.StringIO()
            d.to_csv(buf, index=False, na_rep="")
            buf.seek(0)
            with cur.copy(f"copy public.{tabla} ({', '.join(cols)}) from stdin with (format csv, header true, null '')") as cp:
                cp.write(buf.getvalue())
            conteos[tabla] = len(d)
        cur.execute("select public.aplicar_ventana(%s)", (desde,))
        resultado = cur.fetchone()[0]
        cur.execute("select public.refrescar_resumen(%s::smallint)", (id_sb,))
        resultado += " | " + cur.fetchone()[0]
    conn.commit()
    return conteos, resultado


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--simular", action="store_true", help="no escribe en Supabase")
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    cfg = tomllib.loads((RAIZ / "config.toml").read_text(encoding="utf-8"))
    hoy = date.today()

    if args.simular:
        for id_dwh, id_sb, meses in PAISES:
            desde = inicio_ventana(hoy, meses)
            ciclo, sol, est, usu = leer_dwh(cfg["dwh"], id_dwh, desde)
            tablas = transformar(ciclo, sol, est, usu, id_sb)
            log.info("(simulación) país %s desde %s: %s", id_sb, desde,
                     ", ".join(f"{t}={len(df)}" for t, df in tablas.items()))
        return

    usuario, clave = credencial(cfg["supabase"]["credencial"])
    with psycopg.connect(host=cfg["supabase"]["host"], port=cfg["supabase"]["port"], dbname=cfg["supabase"]["database"],
                         user=usuario, password=clave, sslmode="require") as conn:
        for id_dwh, id_sb, meses in PAISES:
            desde = inicio_ventana(hoy, meses)
            ciclo, sol, est, usu = leer_dwh(cfg["dwh"], id_dwh, desde)
            tablas = transformar(ciclo, sol, est, usu, id_sb)
            conteos, resultado = cargar_pais(conn, tablas, desde, id_sb)
            log.info("País %s desde %s: %s | %s", id_sb, desde, conteos, resultado)


if __name__ == "__main__":
    main()
