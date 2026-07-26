# El Repuesto — Brief Técnico

## Resumen ejecutivo

El Filtro te dice "esta dependencia es un problema". El Repuesto te dice qué hacer con eso: sube de versión, o cámbiala por esto — con datos reales y verificables, sin una sola llamada a un modelo de IA. Es la segunda mitad de un mismo flujo: **diagnóstico → arreglo**, en el mismo lenguaje simple que ya usa El Filtro.

## 1. Problema que resuelve

Hoy, cuando El Filtro (o cualquier auditoría de dependencias) marca un hallazgo, el trabajo real recién empieza:

- Si es una **vulnerabilidad**: hay que leer el aviso, entender si hay una versión parchada, y confiar en que actualizar no rompa nada.
- Si es un paquete **abandonado o deprecado**: hay que salir a buscar alternativas, comparar cuáles siguen mantenidas, y calcular cuánto código tocaría cambiar — trabajo de investigación que le toma tiempo a cualquiera, y que alguien nuevo en la comunidad ni siquiera sabe por dónde empezar.

**Evidencia real, no hipotética:** la propia corrida de El Filtro contra los 22 repos de la carpeta `JULIO/` ya encontró los dos casos exactos que El Repuesto necesita resolver:

- `vitest@2.1.9` — vulnerabilidad crítica real, presente en casi toda la familia de proyectos. Caso de "sube de versión".
- `mersennetwister` en `batallas-imperio-agentico` — paquete abandonado real. Caso de "busca un reemplazo".

El Repuesto no resuelve un problema inventado: resuelve exactamente lo que El Filtro ya demostró que existe en tus propios repos.

## 2. Público objetivo

Cualquier miembro de Imperio Agéntico que corra El Filtro contra sus propios repos y se encuentre con un hallazgo real. El caso más importante para el que hay que diseñar: alguien **nuevo** en la comunidad, sin criterio propio para responder "¿esta alternativa de verdad sirve, o es peor que lo que ya tengo?".

## 3. Frontera con el resto del ecosistema

| Herramienta | Qué hace | Por qué no se pisa con El Repuesto |
|---|---|---|
| El Filtro | Detecta el problema (vulnerable/abandonado) | El Repuesto no detecta nada — consume su reporte |
| La Alarma | Audita secretos e infraestructura | Capa completamente distinta (seguridad operativa) |
| El Blindaje | Audita la capa de prompts/instrucciones | Capa completamente distinta (instrucciones, no dependencias) |

El Repuesto **no vuelve a escanear los repos**. Lee el reporte que El Filtro ya generó y trabaja sobre eso. Esto evita trabajo duplicado y mantiene la separación de responsabilidades: El Filtro diagnostica, El Repuesto receta.

## 4. Principios de diseño (no negociables)

1. **100% determinístico.** Cero llamadas a un modelo de IA, cero interpretación de lenguaje ambiguo. Cada recomendación sale de un dato verificable — una API pública, un número real.
2. **Sin API key.** Mismo estándar que El Filtro: cualquiera en la comunidad lo instala y lo corre sin fricción de configuración.
3. **Solo lectura en v1.** El Repuesto recomienda; no modifica `package.json`, no corre `npm install`, no toca nada. Una posible v2 podría conectarlo con Las Llantas para aplicar el cambio y desplegarlo.
4. **Honestidad por encima de la cobertura.** Si no hay una alternativa clara, lo dice — no fuerza una recomendación floja solo por completar el reporte.

## 5. Arquitectura funcional

### 5.1 Input

El Repuesto lee el reporte JSON que ya produce El Filtro (mismo formato, sin re-escanear nada).

**Punto a confirmar contra el código real de El Filtro antes de plan mode:** el schema exacto de ese reporte — en particular, si el campo de "deprecado" ya incluye el texto crudo del mensaje de deprecación, o si El Repuesto tiene que volver a pedirlo del packument de npm por su cuenta. Este brief asume lo segundo (se vuelve a pedir) hasta confirmar lo contrario, porque es la opción más segura: no depende de que el formato de salida de El Filtro cambie.

### 5.2 Clasificación de la ruta de arreglo

Cada hallazgo de El Filtro cae en una de dos rutas según su naturaleza — nunca las dos a la vez:

**Ruta A — Vulnerable, pero el paquete sigue mantenido** (caso real: vitest)

- Recomendación: subir a la versión que trae el parche.
- Fuente del dato: el mismo aviso de vulnerabilidad que ya usa El Filtro — `npm audit` expone un campo `fixAvailable` con la versión objetivo.
- Nivel de confianza: alto. Es un dato objetivo, no una sugerencia inferida.

**Ruta B — Abandonado o deprecado** (caso real: mersennetwister)

1. **Primer intento:** si el propio mensaje de deprecación del paquete menciona un reemplazo por nombre, se extrae ese texto directamente — es el dato más confiable porque viene del propio autor del paquete.
2. **Segundo intento (si no hay mención):** se busca en el registro público de npm (`registry.npmjs.org/-/v1/search`) usando las palabras clave / categoría del paquete original, y se ordenan los candidatos por los tres scores que la propia API ya calcula: calidad, popularidad y mantenimiento. No hay interpretación de significado — solo ranking por número.
3. **Si ningún candidato pasa un mínimo razonable** (umbral exacto a definir en plan mode; punto de partida sugerido: score de mantenimiento combinado por debajo de 0.5 sobre 1) — El Repuesto lo declara explícitamente: *"no encontramos una alternativa clara para este paquete"*, en vez de sugerir algo débil solo por rellenar el reporte.

### 5.3 Score de facilidad de reemplazo (solo aplica a la Ruta B)

Dos señales, combinadas tomando **el peor caso de las dos** — si cualquiera de las dos sale difícil, el reemplazo se cuenta como difícil; es la lectura más honesta del riesgo real.

**a) Uso en tu código** — cuántos archivos importan esa dependencia:
- 1 a 3 archivos → 🟢 fácil
- 4 a 10 archivos → 🟡 medio
- 11 o más → 🔴 difícil

**b) Compatibilidad de API** — cuántos nombres de función/método que tu código realmente usa de esa dependencia existen también, con el mismo nombre, en el candidato (comparando el archivo de tipos o el punto de entrada del paquete, sin ejecutar código de nadie):
- 70% o más en común → 🟢 fácil
- 40% a 69% → 🟡 medio
- Menos de 40% → 🔴 difícil

### 5.4 Output

Reporte JSON (para integrarse con otras herramientas) + resumen legible en consola, mismo lenguaje visual 🟢🟡🔴 que ya usa El Filtro.

Ejemplo real — caso de reemplazo:

```json
{
  "paquete": "mersennetwister",
  "problema": "abandonado",
  "ruta": "reemplazo",
  "fuente_recomendacion": "registro-npm",
  "candidatos": [
    {
      "nombre": "seedrandom",
      "score_calidad": 0.82,
      "score_mantenimiento": 0.91,
      "facilidad": "🟢",
      "razon": "3 archivos lo usan, 85% de las funciones coinciden"
    }
  ]
}
```

Ejemplo real — caso de versión:

```json
{
  "paquete": "vitest",
  "version_actual": "2.1.9",
  "problema": "vulnerable",
  "ruta": "actualizar_version",
  "version_recomendada": "4.x",
  "fuente_recomendacion": "npm-audit-fix-available"
}
```

## 6. Alcance de esta primera versión

**Dentro:**
- Ecosistema npm únicamente (mismo orden que El Filtro: por etapas, pip después si aplica)
- Las dos rutas completas (versión y reemplazo)
- Reporte JSON + resumen en consola

**Fuera (por ahora):**
- pip
- Cualquier capa de IA
- Modificar archivos del usuario o instalar nada automáticamente
- Conexión automática con Las Llantas (posible v2)

## 7. Etapas de construcción propuestas

Mismo patrón de TDD rojo→verde que ya funcionó con El Filtro, con un criterio de salida claro en cada etapa:

1. **Motor de "sube de versión"** — lee el hallazgo de vulnerabilidad, extrae `fixAvailable` de npm audit, lo expone en el formato de salida. Validar contra el caso real de vitest.
2. **Extracción de reemplazo desde el mensaje de deprecación** — parsear el packument de npm, detectar si el mensaje menciona un nombre de paquete alternativo.
3. **Búsqueda + ranking en el registro de npm** — para cuando el paso 2 no encuentra nada. Validar contra el caso real de mersennetwister.
4. **Score de facilidad de reemplazo** — uso en código (grep/AST) + compatibilidad de API (comparación de exports).
5. **Pulido** — README, LICENSE, CLAUDE.md, ejemplo de reporte real, auditoría de La Alarma, chequeo de El Doctor.

## 8. Validación real

Mismo corpus que ya usó El Filtro: los 22 repos reales de la carpeta `JULIO/`. Como ya sabemos que ahí existen los dos casos exactos (vitest en varios proyectos, mersennetwister en `batallas-imperio-agentico`), la validación no depende de inventar casos de prueba artificiales — el antes/después sale de datos reales, igual que en El Filtro.

## 9. Riesgos y limitaciones conocidas (documentar, no esconder)

- La búsqueda por palabras clave en el registro de npm puede no encontrar nada bueno para paquetes muy nicho o mal categorizados — de ahí la importancia del punto 5.2.3 (decir "no hay alternativa clara" en vez de forzar una mala).
- La comparación de compatibilidad de API es una heurística basada en nombres, no una garantía de que el reemplazo funcione igual — el reporte debe dejar esto claro para que nadie lo tome como un cambio libre de riesgo.

## 10. Stack técnico

Node.js/TypeScript — mismo lenguaje que El Filtro, para reusar su formato de reporte sin fricción de conversión. Vitest para TDD. Cero dependencias de IA o API keys externas.

## 11. Publicación / Logro en Skool

La historia se escribe casi sola: *"El Filtro te dice el problema, El Repuesto te da el arreglo"* — con la captura real de un hallazgo de El Filtro (vitest o mersennetwister) seguida de la recomendación real de El Repuesto para ese mismo hallazgo. Antes/después con los mismos números que ya tienes, sin necesidad de fabricar nada.

## 12. Preguntas abiertas para plan mode

Calibraciones técnicas finas, no decisiones de producto — se resuelven mejor en la práctica que en el papel:

- Confirmar el schema real del reporte de El Filtro (ver 5.1)
- Umbral exacto de score mínimo para descartar un candidato malo (punto de partida sugerido: 0.5)
- Profundidad real de la comparación de API (¿solo funciones de nivel superior, o también métodos anidados?)
