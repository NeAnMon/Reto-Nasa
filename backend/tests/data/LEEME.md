# Datos reales para las pruebas de calibración

Copias **byte a byte** (con `cp`, sin modificar) de dos archivos del repositorio
`astronaut-health-dataset` (https://github.com/ydtoloza/astronaut-health-dataset), commit `63916a8`.
Sostienen las pruebas que miden el motor de alertas y el servicio de predicción con datos reales.

| Archivo aquí | Origen en el dataset | Contenido |
|---|---|---|
| `utmb_vitales_diarios.csv` | `data/interim/utmb_vitales_diarios.csv` | Signos vitales diarios de 29 voluntarios sanos en reposo en cama (2 939 filas, 2 938 con algún signo vital): pulso, presión sistólica y diastólica, frecuencia respiratoria, temperatura y peso, con fase (`pre`, `mision`, `post`) y día de misión. |
| `utmb_lineas_base.csv` | `data/processed/demo_lineas_base.csv` | Media y desviación estándar personales de la fase previa al reposo, por sujeto (40 filas; 29 con vitales). La desviación lleva el piso que aplica el dataset (pulso 6 lpm, PAS 8 mmHg, PAD 6 mmHg, temperatura 0,3 °C, respiración 1,5 rpm). |

## Finales de línea y SHA-256

Los archivos del dataset terminan las líneas en CRLF (así están también en su repositorio). La copia de
trabajo hecha con `cp` es idéntica byte a byte. Este repositorio no tiene `.gitattributes` y se trabaja con
`core.autocrlf=true`, así que **git guarda los CSV con finales LF** (igual que los CSV de
`backend/app/database/data/`): en un checkout de Windows vuelven a salir con CRLF, idénticos al dataset; en
Linux (Docker, VPS) salen con LF. El contenido es el mismo y las pruebas leen ambos. Para conservar los bytes
exactos en git haría falta una regla `backend/tests/data/*.csv -text` en `.gitattributes`.

```
# Como en el dataset (CRLF): copia de trabajo en Windows
548d158fa75ed11c29a26fe3e1c0966d8fc78ac383416eb2cfbedb3ddb0285db  utmb_vitales_diarios.csv  (193 310 bytes)
ec41808fc713de644baef35bb2e8b3db12a358b88884358573bd762bb9f94dd9  utmb_lineas_base.csv      (3 257 bytes)
# Como los guarda git (LF): checkout en Linux
f39243726d8623c19fd2578065cdef968a32f98df039040f3224f2d9c9448dd1  utmb_vitales_diarios.csv  (190 370 bytes)
40b380da528d5ca412b4f1fec18ed1f9a554216d6c1a5bbd93500df4e523a69b  utmb_lineas_base.csv      (3 216 bytes)
```

## Origen de los datos

Estudio de reposo en cama inclinada 6° con la cabeza abajo (head-down bed rest) de la University of Texas
Medical Branch (UTMB), publicado por el NASA Life Sciences Portal (NLSP):
*Case Report Form*, **doi:10.83263/wjw1-ta27** (https://doi.org/10.83263/wjw1-ta27).

El reposo en cama es un **análogo en tierra** de la microgravedad: no son datos de vuelo espacial ni de
astronautas. Los sujetos son voluntarios sanos; el dataset no trae sexo, edad ni nombre.

## Licencia y atribución

Según el dataset (`README.md`, sección "Licencias y citas", y `docs/FUENTES.md`): NLSP marca estos datos
como "Open-Access Data" y su DOI figura en DataCite como **CC0-1.0**, pero el portal no muestra una
licencia explícita. Se pide **citar el DOI del experimento** (el de arriba). La limpieza, la corrección de
errores del origen y el cálculo de las líneas base son del pipeline del dataset (`src/astrohealth/build.py`);
las correcciones aplicadas están en su `data/interim/registro_correcciones.csv`.

## Qué usan las pruebas

- `backend/tests/test_alert_calibration.py`: pasa la función pura del motor de alertas por todas las filas,
  imprime las tasas por indicador y por sujeto-día (antes y después de la calibración) y fija cotas contra
  regresiones. Verla con `pytest backend/tests/test_alert_calibration.py -s`.

No edites estos archivos: si el dataset cambia, vuelve a copiarlos y actualiza los SHA-256 y las cotas.
