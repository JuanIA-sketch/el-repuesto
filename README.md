# 🔧 El Repuesto

**El Filtro te dice el problema. El Repuesto te da el arreglo.**

Lee el reporte de [El Filtro](../El%20Filtro) y te dice qué hacer con cada dependencia
problemática: subir de versión, o cambiar de paquete — con datos reales y verificables.

**100% determinístico: sin IA, sin API key, sin credenciales.** Cada recomendación sale de
un número que puedes comprobar tú mismo.

**Solo lectura.** No modifica tu `package.json`, no instala nada, no toca tus repos.

---

## Uso

```bash
# 1. El Filtro diagnostica
el-filtro --path ./mis-proyectos

# 2. El Repuesto receta
el-repuesto --reporte ./mis-proyectos/.el-filtro/report-<ts>.json
```

Opciones: `--json` (salida máquina-legible) · `--no-write` (no escribir a disco) ·
`--salida <ruta>` (dónde guardar el reporte).

---

## Las dos rutas

### ⬆ Sube de versión — el paquete sigue vivo

Sale de `npm audit`, que ya calculó el arreglo mirando **todo** tu árbol de dependencias.
El Repuesto distingue tres situaciones que se confunden con facilidad:

| Situación | Qué significa | Qué te dice |
|---|---|---|
| **versión exacta** | npm nombró qué instalar | *"Sube vitest a 4.1.10"* (+ aviso si es cambio mayor) |
| **basta actualizar** | el arreglo cabe en el rango que ya declaras | *"Corre `npm update postcss`, no toques tu package.json"* |
| **sin versión segura** | no hay ninguna versión parchada | *"Subir no te saca de esta: hay que reemplazarlo"* |

Un detalle que importa: **el paquete a subir no siempre es el paquete roto.** Si `esbuild`
es vulnerable pero lo arrastra `vitest`, El Repuesto dice *"sube vitest"* — no *"sube
esbuild"*, que ni siquiera está en tu `package.json`.

### 🔄 Cambia de paquete — el paquete está abandonado

1. **¿El mensaje de deprecación nombra un reemplazo?** Es el dato más confiable: lo escribió
   quien mantiene el paquete. Se valida contra el registro antes de proponerlo.
2. **Si no,** se busca en el registro público de npm y se ordenan los candidatos.
3. **Si ninguno pasa el corte,** se dice: *"no encontramos una alternativa clara"*. Preferimos
   admitirlo a rellenar el reporte con algo débil.

---

## Cómo se ordenan los candidatos

> **Los scores que publica la API de búsqueda de npm no sirven.** `score.detail` devuelve
> siempre `{popularity: 1, quality: 1, maintenance: 1}` — verificado en 60 resultados de 3
> consultas distintas. Un paquete sin publicar desde 2016 recibe `maintenance: 1`.

Por eso el ranking se calcula con números duros de la misma respuesta:

- **adopción** — descargas semanales reales
- **respaldo** — cuántos paquetes dependen de él
- **frescura** — meses desde su última publicación real (`package.date`)

Antes del ranking hay filtros duros: fuera los `@types/*`, los deprecados, los marcados
inseguros, los que nadie usa, y los que **no comparten dominio** con el paquete original.

### Score de facilidad de reemplazo

Dos señales, combinadas por el **peor caso** — si cualquiera sale difícil, es difícil:

| Uso en tu código | | Compatibilidad de API | |
|---|---|---|---|
| 1-3 archivos | 🟢 | ≥70% de las funciones que usas | 🟢 |
| 4-10 archivos | 🟡 | 40-69% | 🟡 |
| 11+ archivos | 🔴 | <40% | 🔴 |

Si no se puede comparar la API, sale 🟡 — **nunca 🟢**. Falta de información no es una
buena noticia.

---

## Ejemplo real

`mersennetwister` en un proyecto real: abandonado, su mensaje no nombra reemplazo, 1 archivo
lo usa y de él solo se llama `.random()`.

```
🔄 CAMBIA DE PAQUETE
  • batallas › mersennetwister 0.2.3  (abandonado)
      🟢 mersenne-twister   salud 0.64
          1 archivo lo usa, 100% de las funciones que usas existen con el mismo nombre
      🔴 pcg                salud 0.76
          1 archivo lo usa, 0% de las funciones que usas existen con el mismo nombre
```

`pcg` es más sano, pero `mersenne-twister` es el que puedes adoptar cambiando una línea.
El reporte muestra los dos números para que decidas tú.

---

## Limitaciones conocidas

- **La comparación de API es una heurística de NOMBRES, no de comportamiento.** Que dos
  paquetes tengan un método `random()` no prueba que hagan lo mismo. Mide cuánto
  reescribirías, no si el cambio es seguro.
- **Profundidad de la comparación:** miembros de primer nivel y un salto de alias. No sigue
  cadenas largas ni accesos dinámicos.
- **Un paquete mal categorizado da candidatos flojos.** `request` se autoetiqueta
  `["http","simple","util","utility"]`: con eso, lo mejor que se puede encontrar son
  paquetes del dominio HTTP, no necesariamente clientes HTTP. La búsqueda por keywords no
  puede arreglar una mala categorización de origen.
- **Solo npm.** pip queda fuera de esta versión.

---

## Desarrollo

```bash
npm test          # build + suite completa
npm run test:watch
npm run dev -- --reporte ./ruta/al/report.json
```

Los fixtures son respuestas reales capturadas del registro npm, no inventadas.

## Licencia

MIT
