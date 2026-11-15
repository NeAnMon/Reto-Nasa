import json
import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from backend.app.models.models import (
    Alert,
    CognitiveAssessment,
    CognitiveBaseline,
    CognitiveDomain,
    CognitiveResponse,
    CognitiveResult,
    CognitiveSchedule,
    CognitiveTest,
    CognitiveTestVersion,
)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


COGNITIVE_DOMAINS_CATALOG = [
    {
        "code": "VISUAL_LEARNING",
        "name": "A. Aprendizaje Visual (Visual Learning)",
        "objective": "Observar la capacidad de aprender, codificar y reconocer secuencias de patrones y símbolos visuales presentados brevemente.",
        "scientific_disclaimer": "Actividad de seguimiento operativo (DEMO). Describe el desempeño observado en reconocimiento visual; no constituye diagnóstico neuropsicológico.",
        "badge_code": "VISUAL_NAVIGATOR",
        "test_code": "TEST_VISUAL_LEARNING_1",
        "test_title": "Codificación y Reconocimiento de Patrones Orbitales",
        "instructions": "1. Observe la secuencia de emblemas geométricos durante unos segundos.\n2. Al ocultarse la muestra, identifique cuál par o figura formaba parte de la secuencia original.",
        "practice_example": {
            "prompt": "Ejemplo de práctica: Si vio [▲ Azul, ● Cian, ◆ Verde], ¿cuál símbolo estaba en el centro?",
            "options": ["▲ Azul", "● Cian", "■ Rojo", "★ Ámbar"],
            "correct": "● Cian",
        },
        "tasks": [
            {
                "prompt": "Muestra estudiada: [Hexágono-Alfa, Círculo-Beta, Triángulo-Gamma]. ¿Qué elemento seguía inmediatamente a Hexágono-Alfa?",
                "stimulus": {"sequence": ["⬢ Alfa", "● Beta", "▲ Gamma"], "exposure_ms": 3000},
                "options": ["● Beta", "▲ Gamma", "◆ Delta", "■ Épsilon"],
                "correct": "● Beta",
            },
            {
                "prompt": "Pares asociados: [Módulo-1 → Panel Solar], [Módulo-2 → Antena], [Módulo-3 → Esclusa]. ¿Qué elemento corresponde a Módulo-2?",
                "stimulus": {"pairs": [["Módulo-1", "Panel Solar"], ["Módulo-2", "Antena"], ["Módulo-3", "Esclusa"]]},
                "options": ["Panel Solar", "Antena", "Esclusa", "Radiador"],
                "correct": "Antena",
            },
            {
                "prompt": "Patrón de cuadrícula aprendido: Esquina superior izquierda = Cian; Centro = Verde; Inferior derecha = Ámbar. ¿Qué color ocupaba el centro?",
                "stimulus": {"grid": "3x3_COLOR_MAP"},
                "options": ["Cian", "Verde", "Ámbar", "Violeta"],
                "correct": "Verde",
            },
        ],
    },
    {
        "code": "MEMORY",
        "name": "B. Memoria de Trabajo y Secuencial (Memory)",
        "objective": "Observar la retención a corto plazo de secuencias numéricas, espaciales y simbólicas operativas.",
        "scientific_disclaimer": "Tarea de memoria de trabajo en pantalla (DEMO). Sujeta a efecto de práctica; no mide capacidad mnésica clínica global.",
        "badge_code": "MEMORY_EXPLORER",
        "test_code": "TEST_MEMORY_SEQUENCE_1",
        "test_title": "Retención de Secuencias de Telemetría y Posición",
        "instructions": "1. Memorice la secuencia de códigos y coordenadas mostrada.\n2. Reproduzca el orden exacto o el elemento solicitado sin ayudas externas.",
        "practice_example": {
            "prompt": "Ejemplo: Secuencia [4 - 9 - 2]. ¿Cuál es la secuencia en orden inverso?",
            "options": ["2 - 9 - 4", "4 - 2 - 9", "9 - 4 - 2", "2 - 4 - 9"],
            "correct": "2 - 9 - 4",
        },
        "tasks": [
            {
                "prompt": "Secuencia presentada: [7 - 3 - 8 - 1 - 5]. Seleccione la reproducción exacta:",
                "stimulus": {"digits": [7, 3, 8, 1, 5]},
                "options": ["7 - 3 - 8 - 1 - 5", "7 - 8 - 3 - 1 - 5", "7 - 3 - 1 - 8 - 5", "3 - 7 - 8 - 1 - 5"],
                "correct": "7 - 3 - 8 - 1 - 5",
            },
            {
                "prompt": "Secuencia en orden INVERSO de [A2 - B5 - C9 - D4]:",
                "stimulus": {"codes": ["A2", "B5", "C9", "D4"]},
                "options": ["D4 - C9 - B5 - A2", "D4 - B5 - C9 - A2", "A2 - C9 - B5 - D4", "C9 - D4 - B5 - A2"],
                "correct": "D4 - C9 - B5 - A2",
            },
            {
                "prompt": "Posiciones iluminadas en matriz 3x3: [Fila 1 Col 2] → [Fila 2 Col 3] → [Fila 3 Col 1]. ¿Cuál fue la segunda posición?",
                "stimulus": {"positions": ["R1C2", "R2C3", "R3C1"]},
                "options": ["Fila 1 Col 2", "Fila 2 Col 3", "Fila 3 Col 1", "Fila 2 Col 2"],
                "correct": "Fila 2 Col 3",
            },
        ],
    },
    {
        "code": "ATTENTION",
        "name": "C. Atención Selectiva y Sostenida (Attention)",
        "objective": "Observar la detección de estímulos objetivo entre distractores, registrando aciertos, omisiones y variabilidad de respuesta.",
        "scientific_disclaimer": "Actividad de vigilancia atencional (DEMO). Sensible a fatiga puntual e iluminación ambiental.",
        "badge_code": "ATTENTION_SPECIALIST",
        "test_code": "TEST_ATTENTION_VIGILANCE_1",
        "test_title": "Discriminación de Estímulos Objetivo entre Distractores",
        "instructions": "1. Identifique únicamente el símbolo objetivo '⊕' entre los distractores ('⊗', '⊘', '⊙').\n2. Responda con rapidez y precisión evitando falsas alarmas.",
        "practice_example": {
            "prompt": "Ejemplo: En la fila [⊗  ⊕  ⊘  ⊕  ⊙], ¿cuántas veces aparece el objetivo '⊕'?",
            "options": ["1", "2", "3", "4"],
            "correct": "2",
        },
        "tasks": [
            {
                "prompt": "Matriz de barrido: [⊗ ⊕ ⊘ ⊙ ⊕ ⊗ ⊕ ⊘]. ¿Cuántos objetivos '⊕' están presentes?",
                "stimulus": {"stream": ["⊗", "⊕", "⊘", "⊙", "⊕", "⊗", "⊕", "⊘"], "target": "⊕"},
                "options": ["2", "3", "4", "5"],
                "correct": "3",
            },
            {
                "prompt": "Detección de cambio en telemetría: Serie A=[101.2, 101.2, 101.2, 98.4, 101.2]. ¿En qué posición ocurre la anomalía?",
                "stimulus": {"series": [101.2, 101.2, 101.2, 98.4, 101.2]},
                "options": ["Posición 2", "Posición 3", "Posición 4", "Sin cambio"],
                "correct": "Posición 4",
            },
            {
                "prompt": "Filtro selectivo: Seleccione el único código que comienza con vocal y termina en número par:",
                "stimulus": {"candidates": ["B44", "E73", "A86", "U51"]},
                "options": ["B44", "E73", "A86", "U51"],
                "correct": "A86",
            },
        ],
    },
    {
        "code": "ABSTRACTION",
        "name": "D. Abstracción y Categorización (Abstraction)",
        "objective": "Observar la capacidad para identificar reglas generales, clasificar elementos y detectar el elemento discordante.",
        "scientific_disclaimer": "Tarea de categorización conceptual y visual (DEMO).",
        "badge_code": "PATTERN_DETECTIVE",
        "test_code": "TEST_ABSTRACTION_RULES_1",
        "test_title": "Clasificación de Patrones y Deducción de Reglas",
        "instructions": "1. Analice las propiedades compartidas por el conjunto de figuras o conceptos.\n2. Seleccione la regla general o el elemento que no pertenece a la categoría.",
        "practice_example": {
            "prompt": "Ejemplo: [Oxígeno, Nitrógeno, Dióxido de Carbono, Titanio]. ¿Cuál elemento NO pertenece a la categoría de gases atmosféricos?",
            "options": ["Oxígeno", "Nitrógeno", "Titanio", "Dióxido de Carbono"],
            "correct": "Titanio",
        },
        "tasks": [
            {
                "prompt": "Conjunto: [Triángulo (3 lados), Cuadrado (4 lados), Pentágono (5 lados), Círculo (0 lados rectos)]. ¿Cuál es el elemento discordante?",
                "stimulus": {"shapes": ["Triangle", "Square", "Pentagon", "Circle"]},
                "options": ["Triángulo", "Cuadrado", "Pentágono", "Círculo"],
                "correct": "Círculo",
            },
            {
                "prompt": "Regla de clasificación: Grupo Alfa=[2, 4, 8, 16]; Grupo Beta=[3, 9, 27, 81]. ¿Qué regla define ambos grupos?",
                "stimulus": {"groups": [[2, 4, 8, 16], [3, 9, 27, 81]]},
                "options": [
                    "Progresión geométrica por potencias de la base inicial",
                    "Suma constante de números primos",
                    "Alternancia de pares e impares",
                    "División sucesiva entre 2",
                ],
                "correct": "Progresión geométrica por potencias de la base inicial",
            },
            {
                "prompt": "Complete la pareja conceptual: [Termómetro → Temperatura] es equivalente a [Dosímetro → ___]:",
                "stimulus": {"analogy": "Thermometer:Temperature :: Dosimeter:?"},
                "options": ["Presión arterial", "Radiación ionizante", "Humedad relativa", "Velocidad orbital"],
                "correct": "Radiación ionizante",
            },
        ],
    },
    {
        "code": "SPATIAL_ORIENTATION",
        "name": "E. Orientación Espacial y Rotación Mental (Spatial Orientation)",
        "objective": "Observar la comprensión de relaciones espaciales 2D/3D, rotaciones de acoplamiento y cambios de perspectiva en microgravedad.",
        "scientific_disclaimer": "Actividad de rotación espacial (DEMO). Útil para seguimiento durante la adaptación neuro-vestibular.",
        "badge_code": "SPATIAL_EXPLORER",
        "test_code": "TEST_SPATIAL_ROTATION_1",
        "test_title": "Rotación Mental de Módulos y Acoplamiento 3D",
        "instructions": "1. Visualice el módulo espacial con su vector de referencia.\n2. Aplique mentalmente la rotación indicada (guiñada/cabeceo/alabeo) y elija la orientación resultante.",
        "practice_example": {
            "prompt": "Ejemplo: Si una flecha apunta al NORTE (↑) y gira 90° en sentido horario, ¿hacia dónde apunta?",
            "options": ["ESTE (→)", "SUR (↓)", "OESTE (←)", "NORTE (↑)"],
            "correct": "ESTE (→)",
        },
        "tasks": [
            {
                "prompt": "El puerto de acoplamiento de una nave apunta hacia ARRIBA (+Z) con el panel solar a la IZQUIERDA (-Y). Si la nave rota 180° sobre su eje longitudinal (Roll), ¿dónde queda el panel solar?",
                "stimulus": {"axis": "ROLL_180", "initial": "TOP_+Z_LEFT_-Y"},
                "options": ["A la DERECHA (+Y)", "A la IZQUIERDA (-Y)", "Atrás (-X)", "Sin cambio"],
                "correct": "A la DERECHA (+Y)",
            },
            {
                "prompt": "Forma en 'L' con brazo largo vertical hacia arriba y base hacia la derecha (└). Tras rotar 90° en sentido horario, ¿qué orientación adopta?",
                "stimulus": {"shape": "L_UP_RIGHT", "rotation_deg": 90},
                "options": [
                    "Brazo largo horizontal a la derecha y base hacia abajo (┌)",
                    "Brazo largo hacia abajo y base a la izquierda (┐)",
                    "Brazo largo a la izquierda y base hacia arriba (┘)",
                    "Permanece idéntica (└)",
                ],
                "correct": "Brazo largo horizontal a la derecha y base hacia abajo (┌)",
            },
            {
                "prompt": "Desde la cúpula de observación mirando hacia la proa (+X), el brazo robótico está a estribor (derecha). Si usted flota boca abajo (invertido 180° en eje Z) mirando hacia la misma proa (+X), ¿de qué lado percibe el brazo robótico?",
                "stimulus": {"frame": "INVERTED_MICROGRAVITY_FRAME"},
                "options": ["A su izquierda subjetiva", "A su derecha subjetiva", "Detrás de usted", "Arriba del cenit"],
                "correct": "A su izquierda subjetiva",
            },
        ],
    },
    {
        "code": "EMOTION_RECOGNITION",
        "name": "F. Reconocimiento de Expresiones en Estímulos Controlados (Emotion Recognition)",
        "objective": "Evaluar la identificación de expresiones faciales esquemáticas estandarizadas para apoyar la empatía y comunicación de tripulación.",
        "scientific_disclaimer": "AVISO ÉTICO Y CIENTÍFICO: Utiliza ilustraciones esquemáticas estandarizadas. NUNCA utiliza cámara ni reconocimiento facial sobre el usuario, ni infiere el estado emocional real o personalidad del astronauta.",
        "badge_code": "COGNITIVE_MISSION_COMPLETED",
        "test_code": "TEST_EMOTION_RECOGNITION_1",
        "test_title": "Identificación de Expresiones en Estímulos Visuales Controlados",
        "instructions": "1. Observe la ilustración esquemática estandarizada descrita.\n2. Seleccione la etiqueta emocional que mejor corresponde a los rasgos visuales del estímulo.",
        "practice_example": {
            "prompt": "Ejemplo: Ilustración con comisuras labiales elevadas en arco y arrugas perioculares suaves. ¿Qué expresión representa el estímulo?",
            "options": ["Alegría / Calma positiva", "Ira", "Sorpresa", "Miedo"],
            "correct": "Alegría / Calma positiva",
        },
        "tasks": [
            {
                "prompt": "Estímulo controlado #1: Cejas arqueadas y elevadas simétricamente, párpados ampliamente abiertos y boca ovalada relajada.",
                "stimulus": {"svg_preset": "SURPRISE_SCHEMATIC", "features": ["raised_brows", "wide_eyes", "open_oval_mouth"]},
                "options": ["Sorpresa / Alerta súbita", "Tristeza", "Enojo", "cansancio"],
                "correct": "Sorpresa / Alerta súbita",
            },
            {
                "prompt": "Estímulo controlado #2: Cejas fruncidas hacia el centro e inclinadas hacia abajo, mirada fija y labios tensos comprimidos.",
                "stimulus": {"svg_preset": "TENSION_ANGER_SCHEMATIC", "features": ["furrowed_brows", "compressed_lips"]},
                "options": ["Tensión / Frustración", "Alegría", "Neutralidad", "Somnolencia"],
                "correct": "Tensión / Frustración",
            },
            {
                "prompt": "Estímulo controlado #3: Extremos internos de las cejas elevados, párpados superiores ligeramente caídos y comisuras de la boca descendidas.",
                "stimulus": {"svg_preset": "SADNESS_FATIGUE_SCHEMATIC", "features": ["inner_brows_up", "drooping_corners"]},
                "options": ["Tristeza / Abatimiento", "Sorpresa", "Entusiasmo", "Ira"],
                "correct": "Tristeza / Abatimiento",
            },
        ],
    },
    {
        "code": "ABSTRACT_REASONING",
        "name": "G. Razonamiento Abstracto y Lógico (Abstract Reasoning)",
        "objective": "Observar la resolución de problemas de series lógicas, matrices de relaciones y deducción secuencial.",
        "scientific_disclaimer": "Tarea de razonamiento lógico (DEMO). No representa un cociente intelectual ni diagnóstico clínico.",
        "badge_code": "LOGIC_CHALLENGER",
        "test_code": "TEST_ABSTRACT_REASONING_1",
        "test_title": "Matrices Lógicas y Series de Símbolos",
        "instructions": "1. Examine cómo cambian los elementos en cada fila y columna de la serie.\n2. Deduzca la pieza que completa lógicamente la matriz.",
        "practice_example": {
            "prompt": "Ejemplo: Serie [1, 4, 9, 16, ?]. ¿Qué número completa la serie de cuadrados perfectos?",
            "options": ["20", "24", "25", "36"],
            "correct": "25",
        },
        "tasks": [
            {
                "prompt": "Matriz lógica: Fila 1=[1 círculo, 2 círculos, 3 círculos]; Fila 2=[2 triángulos, 4 triángulos, 6 triángulos]; Fila 3=[3 rombos, 6 rombos, ?]:",
                "stimulus": {"matrix": [[1, 2, 3], [2, 4, 6], [3, 6, "?"]]},
                "options": ["7 rombos", "8 rombos", "9 rombos", "12 rombos"],
                "correct": "9 rombos",
            },
            {
                "prompt": "Serie simbólica: [A1-Z, B2-Y, C3-X, D4-W, ?]. ¿Cuál es el siguiente término?",
                "stimulus": {"sequence": ["A1-Z", "B2-Y", "C3-X", "D4-W"]},
                "options": ["E5-V", "E5-U", "F6-V", "D5-V"],
                "correct": "E5-V",
            },
            {
                "prompt": "Deducción condicional: Si (Soporte Vital Nominal ⇒ Presión = 101 kPa) y actualmente (Presión ≠ 101 kPa), ¿qué conclusión lógica es válida?",
                "stimulus": {"logic": "MODUS_TOLLENS"},
                "options": [
                    "El Soporte Vital NO está en estado Nominal",
                    "La temperatura ha subido",
                    "El Soporte Vital está Nominal",
                    "No se puede deducir nada",
                ],
                "correct": "El Soporte Vital NO está en estado Nominal",
            },
        ],
    },
    {
        "code": "COMPLEX_EXPLORATION",
        "name": "H. Exploración Compleja y Toma de Decisiones (Complex Exploration)",
        "objective": "Observar la planificación de rutas, priorización de múltiples objetivos y adaptación ante restricciones cambiantes.",
        "scientific_disclaimer": "Escenario interactivo de planificación operativa (DEMO).",
        "badge_code": "VISUAL_NAVIGATOR",
        "test_code": "TEST_COMPLEX_EXPLORATION_1",
        "test_title": "Planificación de Ruta Lunar Multi-Objetivo",
        "instructions": "1. Analice el mapa de nodos lunares, consumo de reserva de O₂ y prioridades.\n2. Seleccione la secuencia de decisiones que cumple los objetivos sin agotar márgenes de seguridad.",
        "practice_example": {
            "prompt": "Ejemplo: Dispone de 30 min de reserva. Ruta A tarda 18 min y Ruta B tarda 35 min. ¿Cuál ruta respeta el margen de seguridad?",
            "options": ["Ruta A (18 min)", "Ruta B (35 min)", "Ambas", "Ninguna"],
            "correct": "Ruta A (18 min)",
        },
        "tasks": [
            {
                "prompt": "Escenario Lunar: Usted está en Base Selene con 100 unidades de energía. Debe recolectar Muestra Geológica (Nodo Norte: costo 30), reparar Sensor Solar (Nodo Este: costo 25) y regresar a Esclusa (costo 25). Evite el Cráter Sombra (costo 60). ¿Cuál ruta completa ambos objetivos dentro del límite?",
                "stimulus": {"energy_budget": 100, "nodes": {"North": 30, "East": 25, "Return": 25, "Crater": 60}},
                "options": [
                    "Base → Nodo Norte → Nodo Este → Esclusa (Total: 80 u)",
                    "Base → Cráter Sombra → Nodo Norte → Esclusa (Total: 115 u)",
                    "Base → Cráter Sombra → Nodo Este → Esclusa (Total: 110 u)",
                    "Permanecer sin recolectar muestras",
                ],
                "correct": "Base → Nodo Norte → Nodo Este → Esclusa (Total: 80 u)",
            },
            {
                "prompt": "Cambio dinámico en exploración: A mitad de ruta se detecta incremento de radiación solar. ¿Qué secuencia de decisión prioriza la seguridad según protocolo?",
                "stimulus": {"event": "SOLAR_PARTICLE_ALERT"},
                "options": [
                    "Guardar coordenada actual, suspender recolección secundaria y dirigirse al refugio presurizado más cercano",
                    "Acelerar hacia el punto más lejano sin avisar a Tierra",
                    "Apagar el dosímetro para ahorrar batería",
                    "Ignorar el aviso hasta terminar todos los objetivos",
                ],
                "correct": "Guardar coordenada actual, suspender recolección secundaria y dirigirse al refugio presurizado más cercano",
            },
            {
                "prompt": "Optimización de recursos en mapa de 4 sectores: Sector 1 (Agua +20), Sector 2 (Sin datos), Sector 3 (Antena +15), Sector 4 (Tormenta de polvo).Si solo puede visitar 2 sectores seguros para maximizar recursos y comunicaciones:",
                "stimulus": {"sectors": ["S1_WATER", "S2_UNKNOWN", "S3_COMM", "S4_HAZARD"]},
                "options": ["Sector 1 y Sector 3", "Sector 2 y Sector 4", "Sector 1 y Sector 4", "Sector 3 y Sector 4"],
                "correct": "Sector 1 y Sector 3",
            },
        ],
    },
    {
        "code": "VISUAL_TRACKING",
        "name": "I. Seguimiento Visual Interactivo en Pantalla (Visual Tracking)",
        "objective": "Observar la capacidad de seguir objetos en movimiento e identificar sus trayectorias y posiciones finales.",
        "scientific_disclaimer": "IMPORTANTE: Seguimiento visual interactivo basado en pantalla (mouse/teclado/táctil). NO equivale a una medición clínica oculomotora ni utiliza hardware de eye-tracking.",
        "badge_code": "FOCUS_TRAINING",
        "test_code": "TEST_VISUAL_TRACKING_1",
        "test_title": "Seguimiento de Objetivos Orbitales en Movimiento (Basado en Pantalla)",
        "instructions": "1. Siga visualmente el marcador objetivo en la zona de simulación.\n2. Indique el cuadrante o marcador final al detenerse el movimiento.",
        "practice_example": {
            "prompt": "Ejemplo: El satélite Alfa inicia en el Cuadrante I, se desplaza hacia abajo al Cuadrante IV y luego a la izquierda al Cuadrante III. ¿Dónde terminó?",
            "options": ["Cuadrante I", "Cuadrante II", "Cuadrante III", "Cuadrante IV"],
            "correct": "Cuadrante III",
        },
        "tasks": [
            {
                "prompt": "Rastreo de 2 objetos: Sonda-1 (inicia en X=10, Y=20; velocidad +15 en X, +5 en Y por segundo durante 2 s). ¿Cuál es la posición final de Sonda-1?",
                "stimulus": {"object": "Probe-1", "start": [10, 20], "vel": [15, 5], "time_s": 2},
                "options": ["X=40, Y=30", "X=25, Y=25", "X=30, Y=40", "X=10, Y=30"],
                "correct": "X=40, Y=30",
            },
            {
                "prompt": "Cruce de trayectorias en pantalla: Tres balizas (A, B, C) rotan 90° en sentido antihorario alrededor del centro. Si 'A' estaba ARRIBA (Norte), ¿en qué posición final se detiene 'A'?",
                "stimulus": {"beacons": ["A_NORTH", "B_EAST", "C_SOUTH"], "rotation": "CCW_90"},
                "options": ["IZQUIERDA (Oeste)", "DERECHA (Este)", "ABAJO (Sur)", "ARRIBA (Norte)"],
                "correct": "IZQUIERDA (Oeste)",
            },
            {
                "prompt": "Seguimiento multi-objetivo: El marcador Objetivo-Alfa se mueve [Centro → Superior-Derecha → Inferior-Derecha → Centro-Izquierda]. ¿Cuál fue su última posición?",
                "stimulus": {"path": ["CENTER", "TOP_RIGHT", "BOTTOM_RIGHT", "CENTER_LEFT"]},
                "options": ["Centro-Izquierda", "Inferior-Derecha", "Superior-Derecha", "Centro"],
                "correct": "Centro-Izquierda",
            },
        ],
    },
]


def evaluate_and_complete_cognitive_assessment(
    db: Session,
    assessment: CognitiveAssessment,
    duration_seconds: float,
) -> Tuple[CognitiveResult, Optional[Alert]]:
    responses: List[CognitiveResponse] = (
        db.query(CognitiveResponse)
        .filter(CognitiveResponse.assessment_id == assessment.id)
        .order_by(CognitiveResponse.task_index.asc())
        .all()
    )
    total_items = max(1, len(responses))
    correct_count = sum(1 for r in responses if r.is_correct)
    omissions_count = sum(1 for r in responses if r.is_omission)
    incorrect_count = max(0, total_items - correct_count - omissions_count)
    accuracy_pct = round((correct_count / total_items) * 100.0, 1)

    rts = [r.response_time_ms for r in responses if r.response_time_ms > 0]
    mean_rt = round(sum(rts) / len(rts), 1) if rts else 1200.0
    if len(rts) >= 2:
        variance = sum((x - mean_rt) ** 2 for x in rts) / len(rts)
        rt_std = round(math.sqrt(variance), 1)
    else:
        rt_std = 0.0

    total_moves = sum(r.moves_or_actions_count for r in responses)

    # Compare ONLY with comparable personal baseline (same domain, difficulty, and version)
    baseline = (
        db.query(CognitiveBaseline)
        .filter(
            CognitiveBaseline.astronaut_id == assessment.astronaut_id,
            CognitiveBaseline.domain_code == assessment.domain_code,
            CognitiveBaseline.difficulty == assessment.difficulty,
            CognitiveBaseline.version_number == assessment.version_number,
        )
        .first()
    )
    if not baseline:
        baseline = CognitiveBaseline(
            astronaut_id=assessment.astronaut_id,
            domain_code=assessment.domain_code,
            difficulty=assessment.difficulty,
            version_number=assessment.version_number,
            baseline_accuracy_percent=accuracy_pct,
            baseline_mean_rt_ms=mean_rt,
            established_at=utcnow(),
            is_simulated=assessment.is_simulated,
        )
        db.add(baseline)
        db.flush()

    acc_delta = accuracy_pct - baseline.baseline_accuracy_percent
    rt_delta = mean_rt - baseline.baseline_mean_rt_ms
    requires_review = acc_delta <= -25.0 or (rt_delta >= 1200.0 and accuracy_pct < 60.0)

    practice_note = (
        f"Intento #{assessment.attempt_number} en dificultad {assessment.difficulty} (v{assessment.version_number}). "
        "Nota metodológica: La mejora progresiva en precisión o tiempo puede reflejar el efecto de práctica "
        "(familiaridad con la tarea) y sólo es comparable con evaluaciones del mismo dominio, dificultad y versión."
    )

    summary_text = (
        f"Desempeño observado en {assessment.domain_code} ({assessment.difficulty}): "
        f"{correct_count}/{total_items} aciertos ({accuracy_pct}%), tiempo medio de respuesta {mean_rt} ms "
        f"(variabilidad ±{rt_std} ms). Condición reportada al iniciar: {assessment.readiness_status}. "
        "Este resultado describe la ejecución en una actividad específica y no constituye un diagnóstico neuropsicológico."
    )

    existing_res = (
        db.query(CognitiveResult)
        .filter(CognitiveResult.assessment_id == assessment.id)
        .first()
    )
    if existing_res:
        existing_res.total_items = total_items
        existing_res.correct_count = correct_count
        existing_res.incorrect_count = incorrect_count
        existing_res.omissions_count = omissions_count
        existing_res.accuracy_percent = accuracy_pct
        existing_res.mean_response_time_ms = mean_rt
        existing_res.response_time_variability_ms = rt_std
        existing_res.moves_count = total_moves
        existing_res.targets_tracked = total_items if assessment.domain_code == "VISUAL_TRACKING" else 0
        existing_res.requires_review = requires_review
        existing_res.practice_effect_note = practice_note
        existing_res.non_diagnostic_summary = summary_text
        result_obj = existing_res
    else:
        result_obj = CognitiveResult(
            assessment_id=assessment.id,
            total_items=total_items,
            correct_count=correct_count,
            incorrect_count=incorrect_count,
            omissions_count=omissions_count,
            accuracy_percent=accuracy_pct,
            mean_response_time_ms=mean_rt,
            response_time_variability_ms=rt_std,
            moves_count=total_moves,
            targets_tracked=total_items if assessment.domain_code == "VISUAL_TRACKING" else 0,
            requires_review=requires_review,
            practice_effect_note=practice_note,
            non_diagnostic_summary=summary_text,
            created_at=utcnow(),
        )
        db.add(result_obj)
        db.flush()

    alert_obj = None
    if requires_review:
        alert_obj = Alert(
            astronaut_id=assessment.astronaut_id,
            mission_id=assessment.mission_id,
            indicator_code="PERCEIVED_FATIGUE",
            measurement_id=None,
            rule_version_id=None,
            rule_code="RULE_COGNITIVE_OBSERVATION_DEMO",
            rule_version_label=assessment.version_number,
            value_recorded=f"{accuracy_pct}% ({mean_rt} ms)",
            unit="% aciertos",
            priority="LOW",
            operational_state="MONITOR",
            status="NEW",
            title=f"[MONITOR] Variación observada en tarea cognitiva ({assessment.domain_code})",
            explanation=(
                f"Se observó una variación respecto a la línea base comparable en {assessment.domain_code} "
                f"({accuracy_pct}% vs base {baseline.baseline_accuracy_percent}%). "
                "No representa un diagnóstico clínico; se sugiere revisar descanso, fatiga y condiciones de realización."
            ),
            data_quality="SYNTHETIC_DEMO" if assessment.is_simulated else "VALIDATED",
            immediate_action="Revisar horas de sueño recientes y considerar una pausa de recuperación neurocognitiva.",
            followup_recommendation="Repetir la actividad en condiciones descansadas cuando el protocolo lo indique.",
            environment_code=assessment.environment_code,
            phase_code=assessment.phase_code,
            is_simulated=assessment.is_simulated,
            created_at=utcnow(),
            updated_at=utcnow(),
        )
        db.add(alert_obj)
        db.flush()

    return result_obj, alert_obj

