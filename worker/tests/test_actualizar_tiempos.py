"""Pruebas de las funciones puras del worker. No tocan el DWH ni Supabase.

Ejecutar desde worker/:  python -m unittest discover -s tests
"""
import sys
import unittest
from datetime import date
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import actualizar_tiempos as at  # noqa: E402


class VentanaTest(unittest.TestCase):
    def test_mes_en_curso_con_una_ventana(self):
        self.assertEqual(at.inicio_ventana(date(2026, 11, 23), 1), date(2026, 11, 1))

    def test_tres_meses_en_el_mismo_anio(self):
        self.assertEqual(at.inicio_ventana(date(2026, 11, 23), 3), date(2026, 9, 1))

    def test_cruza_el_cambio_de_anio(self):
        self.assertEqual(at.inicio_ventana(date(2026, 2, 10), 3), date(2025, 12, 1))

    def test_tres_meses_desde_enero(self):
        self.assertEqual(at.inicio_ventana(date(2026, 1, 5), 3), date(2025, 11, 1))


class TransformarTest(unittest.TestCase):
    def setUp(self):
        self.ciclo = pd.DataFrame({
            "SOLICITUD": [10, 10], "ID_MOVIMIENTO": [1, 2], "ID_ESTADO": [100, 200],
            "ID_ESTADO_DESTINO": [200, None], "ID_USUARIO_MODIFICA": [7, 99],
        })
        self.sol = pd.DataFrame({"SOLICITUD": [10], "CLIENTE": ["no debe pasar"],
                                 "FECHA_CREACION": [pd.Timestamp("2026-11-02")]})
        self.est = pd.DataFrame({"ID_ESTADO": [100, 200], "ESTADO": ["NUEVO", "FORMALIZADO"]})
        self.usu = pd.DataFrame({"ID_USUARIO": [7, None], "USUARIO": ["Ana", "sin id"]})

    def test_nombres_salen_de_los_catalogos(self):
        t = at.transformar(self.ciclo, self.sol, self.est, self.usu, id_sb=3)
        c = t["stg_ciclo_estado"]
        self.assertEqual(list(c["estado"]), ["NUEVO", "FORMALIZADO"])
        self.assertEqual(c["estado_destino"].iloc[0], "FORMALIZADO")
        self.assertTrue(pd.isna(c["estado_destino"].iloc[1]))
        self.assertEqual(c["usuario_modifica"].iloc[0], "Ana")
        self.assertTrue(pd.isna(c["usuario_modifica"].iloc[1]))

    def test_todas_las_filas_llevan_el_id_de_supabase(self):
        t = at.transformar(self.ciclo, self.sol, self.est, self.usu, id_sb=3)
        for nombre in ("stg_ciclo_estado", "stg_solicitud", "stg_estado_catalogo", "stg_usuario_real"):
            self.assertTrue((t[nombre]["id_pais"] == 3).all(), nombre)

    def test_cliente_no_se_carga(self):
        t = at.transformar(self.ciclo, self.sol, self.est, self.usu, id_sb=3)
        self.assertNotIn("cliente", t["stg_solicitud"].columns)

    def test_usuarios_sin_id_se_descartan(self):
        t = at.transformar(self.ciclo, self.sol, self.est, self.usu, id_sb=3)
        self.assertEqual(list(t["stg_usuario_real"]["id_usuario"]), [7])


class ConfiguracionTest(unittest.TestCase):
    def test_paises_cubren_los_cuatro_de_supabase(self):
        self.assertEqual(sorted(p[1] for p in at.PAISES), [1, 2, 3, 4])

    def test_costa_rica_solo_un_mes(self):
        meses = {p[1]: p[2] for p in at.PAISES}
        self.assertEqual(meses[1], 1)


if __name__ == "__main__":
    unittest.main()
