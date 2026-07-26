import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Facilidad } from '../types.js';

/**
 * Señal (a) del brief §5.3: cuántos archivos de TU código importan la dependencia.
 *
 * Es la mitad barata y objetiva del score de facilidad: no importa qué tan buena sea la
 * alternativa si tienes que tocar 40 archivos para cambiarla.
 */

/** Mismo criterio que `discovery.ts` de El Filtro, más las carpetas de build. */
const IGNORAR: ReadonlySet<string> = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'out', 'vendor',
]);

const EXTENSIONES: ReadonlySet<string> = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx', '.svelte', '.vue',
]);

/** Escapa lo que en un nombre de paquete es especial para una regex (@, /, ., -). */
function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * ¿Este archivo IMPORTA el paquete? Solo cuentan import/require/export-from reales:
 * un comentario o una mención en prosa no es uso. El `(?:/[^'"]*)?` acepta subrutas
 * (`lodash/merge`) y el cierre de comilla evita que `mersennetwister` case con
 * `mersennetwister-extra`.
 */
function importaElPaquete(contenido: string, paquete: string): boolean {
  const p = escaparRegex(paquete);
  const especificador = String.raw`['"]${p}(?:/[^'"]*)?['"]`;
  const patrones = [
    new RegExp(String.raw`\bimport\b[^;\n]*?\bfrom\s*${especificador}`),
    new RegExp(String.raw`\bimport\s*${especificador}`), // import 'pkg' (side-effect)
    new RegExp(String.raw`\brequire\s*\(\s*${especificador}\s*\)`),
    new RegExp(String.raw`\bexport\b[^;\n]*?\bfrom\s*${especificador}`),
    new RegExp(String.raw`\bimport\s*\(\s*${especificador}\s*\)`), // import() dinámico
  ];
  return patrones.some((re) => re.test(contenido));
}

/** Recorre el repo devolviendo los archivos de código, sin entrar a lo ignorado. */
function* archivosDeCodigo(dir: string): Generator<string> {
  let entradas;
  try {
    entradas = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // carpeta ilegible: se salta, no tumba el conteo
  }
  for (const e of entradas) {
    if (e.name.startsWith('.') && e.name !== '.') {
      if (IGNORAR.has(e.name)) continue;
    }
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORAR.has(e.name)) continue;
      yield* archivosDeCodigo(full);
    } else if (e.isFile()) {
      const punto = e.name.lastIndexOf('.');
      if (punto > 0 && EXTENSIONES.has(e.name.slice(punto))) yield full;
    }
  }
}

/**
 * Cuántos archivos del repo importan el paquete. Nunca lanza: una ruta que no existe
 * (el reporte puede venir de otra máquina) devuelve 0.
 */
export function contarArchivosQueUsan(repoPath: string, paquete: string): number {
  if (!existsSync(repoPath)) return 0;
  try {
    if (!statSync(repoPath).isDirectory()) return 0;
  } catch {
    return 0;
  }

  let total = 0;
  for (const archivo of archivosDeCodigo(repoPath)) {
    try {
      if (importaElPaquete(readFileSync(archivo, 'utf8'), paquete)) total += 1;
    } catch {
      // archivo binario o sin permisos: se ignora
    }
  }
  return total;
}

/** Umbrales del brief §5.3. 0 archivos es 🟢: si no lo usas, cambiarlo no cuesta nada. */
export function facilidadPorUso(archivos: number): Facilidad {
  if (archivos <= 3) return '🟢';
  if (archivos <= 10) return '🟡';
  return '🔴';
}

/** Devuelve los archivos que importan el paquete (para poder leer su superficie usada). */
export function archivosQueUsan(repoPath: string, paquete: string): string[] {
  if (!existsSync(repoPath)) return [];
  const out: string[] = [];
  for (const archivo of archivosDeCodigo(repoPath)) {
    try {
      if (importaElPaquete(readFileSync(archivo, 'utf8'), paquete)) out.push(archivo);
    } catch {
      /* ignorado */
    }
  }
  return out;
}
