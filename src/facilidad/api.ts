import type { Facilidad } from '../types.js';

/**
 * Señal (b) del brief §5.3: cuánto de la API que TÚ usas existe, con el mismo nombre, en
 * el candidato.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * ESTO ES UNA HEURÍSTICA DE NOMBRES, NO UNA GARANTÍA (brief §9)
 *
 * Que dos paquetes tengan un método `random()` no prueba que se comporten igual. Lo que
 * mide es cuánto tendrías que reescribir, no si el reemplazo funciona. El reporte lo dice
 * en voz alta y por eso el resultado nunca se presenta como "cambio sin riesgo".
 *
 * PROFUNDIDAD DECLARADA: miembros de primer nivel + UN salto de alias. Se detecta
 * `new Pkg()` → `x.metodo()`, pero no un segundo salto (`const y = x`). Sin un parser de
 * verdad, seguir más saltos produce más falsos positivos que aciertos — y aquí un falso
 * positivo es prometer compatibilidad que no existe.
 *
 * No se usa un parser (acorn u otro) a propósito: metería una dependencia y aun así no
 * leería TypeScript, que es la mitad del corpus real.
 * ────────────────────────────────────────────────────────────────────────────────────
 */

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Miembros que existen en todo objeto JS y no dicen nada de la API del paquete. */
const RUIDO: ReadonlySet<string> = new Set([
  'prototype', 'constructor', 'call', 'apply', 'bind', 'toString', 'valueOf',
  'hasOwnProperty', 'length', 'name', 'default', 'then', 'catch', 'finally',
]);

function limpiar(nombres: Iterable<string>): string[] {
  return [...new Set([...nombres].filter((n) => n && !RUIDO.has(n)))];
}

/**
 * Los bindings locales con que este archivo nombra al paquete, y si son "namespace-like"
 * (default/namespace, sobre los que se accede con punto) o named imports (que ya SON la
 * superficie usada).
 */
function bindingsDe(codigo: string, paquete: string): { objeto: string[]; nombrados: string[] } {
  const p = escaparRegex(paquete);
  const esp = String.raw`['"]${p}(?:/[^'"]*)?['"]`;
  const objeto: string[] = [];
  const nombrados: string[] = [];

  // import X from 'pkg'  ·  import * as X from 'pkg'
  for (const re of [
    new RegExp(String.raw`\bimport\s+(\w+)\s*,?\s*(?:\{[^}]*\})?\s*from\s*${esp}`, 'g'),
    new RegExp(String.raw`\bimport\s*\*\s*as\s+(\w+)\s+from\s*${esp}`, 'g'),
    new RegExp(String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*${esp}\s*\)`, 'g'),
  ]) {
    for (const m of codigo.matchAll(re)) objeto.push(m[1]);
  }

  // import { a, b as c } from 'pkg'  ·  const { a, b } = require('pkg')
  for (const re of [
    new RegExp(String.raw`\bimport\s*(?:\w+\s*,\s*)?\{([^}]*)\}\s*from\s*${esp}`, 'g'),
    new RegExp(String.raw`\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*${esp}\s*\)`, 'g'),
  ]) {
    for (const m of codigo.matchAll(re)) {
      for (const parte of m[1].split(',')) {
        // "b as c" → la API del paquete es `b`, no el alias local.
        const nombre = parte.trim().split(/\s+as\s+/)[0].trim();
        if (/^\w+$/.test(nombre)) nombrados.push(nombre);
      }
    }
  }

  return { objeto, nombrados };
}

/**
 * Nombres del paquete que este archivo usa realmente.
 *
 * Los named imports cuentan directo. Para los bindings de objeto se recogen los accesos
 * `binding.X`, y además se sigue UN salto: si el binding se instancia o se llama y el
 * resultado se guarda en una variable, los accesos sobre esa variable también cuentan.
 */
export function superficieUsada(codigo: string, paquete: string): string[] {
  if (typeof codigo !== 'string' || codigo === '') return [];

  const { objeto, nombrados } = bindingsDe(codigo, paquete);
  if (objeto.length === 0 && nombrados.length === 0) return [];

  const usados = new Set<string>(nombrados);

  // Un salto de alias: const MT_ = new MersenneTwister(7)  ·  const f = pkg(...)
  const alias: string[] = [];
  for (const b of objeto) {
    const re = new RegExp(String.raw`\b(?:const|let|var)\s+(\w+)\s*=\s*(?:new\s+)?${escaparRegex(b)}\s*\(`, 'g');
    for (const m of codigo.matchAll(re)) alias.push(m[1]);
  }

  // Accesos de primer nivel sobre el binding o su alias. El `(?!\s*\.)` no hace falta:
  // la regex captura solo el primer identificador tras el punto, así que en a.b.c toma `b`.
  for (const nombre of [...objeto, ...alias]) {
    const re = new RegExp(String.raw`\b${escaparRegex(nombre)}\s*\.\s*(\w+)`, 'g');
    for (const m of codigo.matchAll(re)) usados.add(m[1]);
  }

  return limpiar(usados);
}

/**
 * Nombre PÚBLICO de una entrada de un bloque de export o de un literal de objeto.
 *
 * La dirección importa y es contraria a la de los imports: en `import {b as c}` la API del
 * paquete es `b` (lo de antes del `as`), pero en `export {default as randomUniform}` la API
 * es `randomUniform` (lo de después). Tomar el primero aquí devolvía "default" y dejaba la
 * superficie vacía — es exactamente lo que pasaba con d3-random.
 */
function nombrePublico(parte: string): string | null {
  const limpio = parte.trim();
  if (!limpio) return null;
  const conAs = limpio.split(/\s+as\s+/);
  // `clave: valor` de un literal de objeto → la API es la clave.
  const nombre = (conAs.length > 1 ? conAs[conAs.length - 1] : limpio).split(':')[0].trim();
  return /^\w+$/.test(nombre) ? nombre : null;
}

/**
 * Nombres que el candidato expone en su punto de entrada.
 *
 * Funciona sobre `.d.ts` cuando lo publica y sobre JS plano cuando no — que es el caso
 * real: ni `mersennetwister` ni `mersenne-twister` publican tipos, así que una versión
 * que solo leyera `.d.ts` fallaría justo en el caso que hay que validar.
 */
export function superficieOfrecida(contenido: string, nombreArchivo: string): string[] {
  if (typeof contenido !== 'string' || contenido === '') return [];

  const nombres = new Set<string>();
  const esDts = nombreArchivo.endsWith('.d.ts');

  const patrones: RegExp[] = esDts
    ? [
        /\bexport\s+declare\s+(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/g,
        /\bdeclare\s+(?:function|const|let|var|class)\s+(\w+)/g,
        /\bexport\s+(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/g,
        /\bexport\s*\{([^}]*)\}/g,
      ]
    : [
        /\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/g,
        /\bexport\s*\{([^}]*)\}/g,
        /\bexports\.(\w+)\s*=/g,
        /\bmodule\.exports\.(\w+)\s*=/g,
        /(\w+)\.prototype\.(\w+)\s*=/g,
        /\bmodule\.exports\s*=\s*\{([^}]*)\}/g,
      ];

  for (const re of patrones) {
    for (const m of contenido.matchAll(re)) {
      // `X.prototype.Y =` deja el miembro en el grupo 2; el resto, en el grupo 1.
      const bruto = m[2] ?? m[1];
      if (!bruto) continue;
      // Bloque de exports o literal de objeto: se parten sus claves. Se procesa también
      // sin coma, porque `export {default as randomUniform}` es un bloque de uno solo.
      for (const parte of bruto.split(',')) {
        const clave = nombrePublico(parte);
        if (clave) nombres.add(clave);
      }
    }
  }

  return limpiar(nombres);
}

/**
 * Fracción 0..1 de lo que usas que existe con el mismo nombre en el candidato.
 * `null` cuando falta alguna de las dos superficies — no saber NO es lo mismo que
 * ser compatible, y confundirlos sería prometer lo que no se verificó.
 */
export function compatibilidadApi(usada: string[], ofrecida: string[]): number | null {
  if (usada.length === 0 || ofrecida.length === 0) return null;
  const disponibles = new Set(ofrecida);
  const coinciden = usada.filter((n) => disponibles.has(n)).length;
  return coinciden / usada.length;
}

/** Umbrales del brief §5.3. Sin dato → 🟡; nunca 🟢 por falta de información. */
export function facilidadPorApi(compatibilidad: number | null): Facilidad {
  if (compatibilidad === null) return '🟡';
  if (compatibilidad >= 0.7) return '🟢';
  if (compatibilidad >= 0.4) return '🟡';
  return '🔴';
}
