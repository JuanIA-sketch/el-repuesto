# CLAUDE.md — El Repuesto

Lee el reporte de El Filtro y receta el arreglo de cada dependencia problemática: subir de
versión o cambiar de paquete. 100% determinístico: **sin LLM, sin API key, sin credenciales**.
Solo lectura: no modifica `package.json` ni instala nada.

## Reglas del proyecto

- **TDD rojo→verde con Vitest, sin excepciones.** Ningún código de producción sin un test
  que haya fallado primero.
- **Nunca `grep -n` para buscar secretos** — solo `grep -l` o `grep -q`.
- **Confirmación explícita antes de `git push`, `gh repo create` o `npm publish`.**
- Los fixtures son **respuestas reales capturadas** (registro npm, búsqueda, packuments),
  no inventadas. Si necesitas uno nuevo, captúralo de verdad.

## Arquitectura

Funciones **puras** para toda la lógica y **bordes** finos e inyectables para I/O (red,
filesystem). Mismo patrón que El Filtro.

```
src/
  cli.ts                 Commander; cablea los bordes reales
  recomendar.ts          Orquestador: reporte → ruta A|B → salida
  filtro.ts              Lector/validador del reporte de El Filtro
  rutas.ts               vulnerable → versión · abandonado → reemplazo
  reporte.ts             Contrato JSON, render de consola, escritura a disco
  types.ts               Tipos del contrato de salida
  version/subir.ts       Ruta A: los tres estados de fixAvailable
  reemplazo/
    mensaje.ts           Extrae el NOMBRE del mensaje de deprecación
    buscar.ts            Filtros duros + score de salud + umbral
    registro.ts          BORDE: packument completo y búsqueda
    recetar.ts           Ruta B completa, con facilidad
  facilidad/
    uso.ts               Cuántos archivos importan el paquete
    api.ts               Superficie usada vs. ofrecida
    entrada.ts           Resuelve el entry point del candidato
    combinar.ts          Peor caso de las dos señales
```

**Regla de inyección:** todo lo que toque red o disco entra como parámetro
(`ConsultarPackument`, `BuscarEnRegistro`, `LeerArchivoRemoto`).

## Decisiones que NO deben revertirse sin pensarlo

- **`fixAvailable` tiene TRES estados, no dos.** Objeto → hay que instalar algo distinto de
  lo declarado. `true` pelado → se arregla dentro del rango ya declarado (es el arreglo MÁS
  BARATO, no uno dudoso). `false` → no hay versión segura. Confundir los dos últimos diría
  "no hay arreglo" del caso más fácil del reporte.
- **El campo `fix` AUSENTE ≠ `fix: null`.** Ausente = reporte de una versión vieja de El
  Filtro → se pide volver a correrlo. Null = npm no nombró versión. Por eso `buildReport`
  de El Filtro normaliza `fix` a null: para que esta distinción sea posible.
- **Los scores de la API de búsqueda de npm están muertos.** `score.detail` devuelve SIEMPRE
  `{popularity:1, quality:1, maintenance:1}` — verificado en 60 resultados de 3 consultas,
  incluido un paquete de 2016 con `maintenance: 1`. El ranking se calcula aquí, con
  `downloads.weekly`, `dependents` y `package.date`.
- **`package.date` es la fecha de publicación; `updated` NO.** `updated` es el refresco del
  índice de búsqueda y marca "hoy" para paquetes de hace 10 años.
- **Hay que pedir el packument COMPLETO, no el abreviado.** El abreviado que usa El Filtro
  no trae `keywords`, y las keywords son lo que arma la consulta de búsqueda.
- **El solape de keywords (≥2) es el filtro que salva el resultado.** Sin él, el ranking por
  salud proponía `crypto-random-string` y `postgres-range` para reemplazar un Mersenne
  Twister. Hay un test antirregresivo que lo fija.
- **Sin dato de compatibilidad → 🟡, nunca 🟢.** Falta de información no puede disfrazarse
  de buena noticia.
- **En un IMPORT `{b as c}` la API es `b`; en un EXPORT `{default as X}` la API es `X`.**
  Direcciones opuestas. Tomar la primera en ambos dejaba vacía la superficie de d3-random.
- **Un hallazgo que falla no tumba el reporte.** Mismo principio que el escaneo de El Filtro.

## Umbrales (calibrados contra casos reales, no a ojo)

- **Salud mínima: 0.45.** `mersenne-twister` saca 0.636 pese a no publicar desde 2016 (su
  adopción lo compensa); `fast-mersenne-twister` saca 0.364 y queda fuera.
- **Uso en código:** 1-3 archivos 🟢 · 4-10 🟡 · 11+ 🔴
- **Compatibilidad de API:** ≥70% 🟢 · 40-69% 🟡 · <40% 🔴
- **Profundidad de la comparación de API:** miembros de primer nivel + UN salto de alias.
  Sin parser a propósito: metería una dependencia y aun así no leería TypeScript.

## Comandos

```bash
npm test          # build + suite completa
npm run test:watch
npm run dev -- --reporte ./ruta/al/report.json
```

## Relación con El Filtro

El Repuesto **no escanea nada**: consume `.el-filtro/report-<ts>.json`. El campo `fix` que
lee es aditivo al contrato `schemaVersion: 1` de El Filtro.
