/**
 * Ruta B, paso 2 del brief (§5.2): cuando el mensaje de deprecación no nombra reemplazo,
 * se busca en el registro público de npm y se ordenan los candidatos.
 *
 * ────────────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL RANKING NO USA LOS SCORES DE LA API
 *
 * El brief planeaba ordenar por los tres scores que la API de búsqueda ya calcula
 * (calidad, popularidad, mantenimiento) y descartar bajo 0.5 de mantenimiento. Esos campos
 * están muertos: `score.detail` devuelve SIEMPRE exactamente `{popularity:1, quality:1,
 * maintenance:1}`. Verificado en 60 resultados de 3 consultas distintas, incluido
 * `mersenne-twister`, sin publicar desde 2016, con `maintenance: 1`. Y `score.final` no es
 * 0..1 sino relevancia sin acotar (127.88, 1359.86).
 *
 * La misma respuesta sí trae números duros y verificables, y sobre esos se reconstruye:
 * `downloads.weekly`, `dependents`, `package.date` y `package.keywords`.
 *
 * OJO con `updated`: NO es la fecha de publicación sino el refresco del índice de búsqueda
 * (marcaba hoy para un paquete publicado en 2016). La fecha real es `package.date`.
 * ────────────────────────────────────────────────────────────────────────────────────
 */

import type { Candidato } from '../types.js';

/**
 * Corte mínimo de salud para proponer un candidato. Calibrado contra el caso real, no
 * elegido a ojo: `mersenne-twister` saca 0.636 pese a no publicar desde 2016 (su adopción
 * masiva lo compensa) y `fast-mersenne-twister` saca 0.364 y queda fuera. Un umbral basado
 * solo en frescura habría descartado al mejor candidato.
 */
export const UMBRAL_SALUD = 0.45;

/** Cuántos candidatos se proponen. Más de 3 es ruido; menos esconde alternativas. */
const MAX_CANDIDATOS = 3;

/** Mínimo de keywords en común con el paquete muerto para considerarlo del mismo dominio. */
const MIN_SOLAPE_KEYWORDS = 2;

/**
 * Keywords que casi todo paquete de npm se pone y que por eso no dicen de qué es.
 *
 * Encontrado en el e2e, no en teoría: `request` (cliente HTTP) se etiqueta
 * ["http","simple","util","utility"], y como TODO helper de npm lleva "util"+"utility",
 * el solape de 2 se cumplía con utilidades de AST de markdown. El Repuesto llegó a
 * proponer `unist-util-visit` y `mdast-util-from-markdown` para reemplazar un cliente HTTP.
 *
 * Se excluyen del solape Y de la consulta de búsqueda: contaminan las dos.
 */
const KEYWORDS_GENERICAS: ReadonlySet<string> = new Set([
  'util', 'utils', 'utility', 'utilities', 'simple', 'easy', 'fast', 'small', 'tiny',
  'lightweight', 'javascript', 'js', 'node', 'nodejs', 'npm', 'module', 'modules',
  'library', 'lib', 'tool', 'tools', 'helper', 'helpers', 'wrapper', 'cli',
  'typescript', 'ts', 'browser', 'universal', 'isomorphic', 'common', 'core',
  'misc', 'general', 'zero-dependency', 'dependency-free',
]);

/**
 * Las keywords que sí identifican un dominio, normalizadas y sin repetir.
 * Si una lista se queda vacía, ese paquete no tiene dominio identificable y no se puede
 * afirmar que nada sea su reemplazo.
 */
export function keywordsEspecificas(keywords: string[]): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    const limpia = k.toLowerCase().trim();
    if (!limpia || KEYWORDS_GENERICAS.has(limpia) || vistas.has(limpia)) continue;
    vistas.add(limpia);
    out.push(limpia);
  }
  return out;
}

const MESES_A_CERO_FRESCURA = 60; // 5 años sin publicar → frescura 0

export interface SenalesCandidato {
  nombre: string;
  descargas: number;
  dependientes: number;
  publicado: string;
  keywords: string[];
  inseguro: boolean;
  deprecado: boolean;
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

/**
 * Salud de un candidato, 0..1. Tres señales objetivas:
 *
 *   adopcion  cuánta gente lo usa hoy (log: 1M dl/semana ≈ 1.0, 1.000 ≈ 0.5)
 *   respaldo  cuántos paquetes dependen de él (log: 1.000 dependientes = 1.0)
 *   frescura  qué tan reciente es su última publicación (5 años → 0)
 *
 * Los pesos hacen que la adopción pese más que la frescura a propósito: una librería
 * pequeña, estable y terminada no es lo mismo que una abandonada, y el número de gente
 * que la usa hoy lo distingue mejor que la fecha.
 */
export function scoreSalud(
  s: { descargas: number; dependientes: number; publicado: string },
  ahora: Date = new Date(),
): number {
  const adopcion = clamp01(Math.log10(Math.max(0, s.descargas) + 1) / 6);
  const respaldo = clamp01(Math.log10(Math.max(0, s.dependientes) + 1) / 3);

  const fecha = new Date(s.publicado).getTime();
  const meses = Number.isNaN(fecha)
    ? Infinity // fecha ilegible → se trata como muy vieja, nunca como NaN
    : (ahora.getTime() - fecha) / (1000 * 60 * 60 * 24 * 30.44);
  const frescura = clamp01(1 - meses / MESES_A_CERO_FRESCURA);

  return 0.45 * adopcion + 0.25 * respaldo + 0.3 * frescura;
}

/**
 * Filtros duros: razón por la que un candidato queda fuera, o null si sobrevive.
 * Se aplican ANTES del score — ningún número de salud rescata a un candidato que ya
 * falló aquí.
 */
export function descalificar(
  c: SenalesCandidato,
  paqueteMuerto: string,
  keywordsMuerto: string[],
): string | null {
  if (c.nombre.startsWith('@types/')) return 'es un paquete de tipos, no una implementación';
  if (c.nombre.toLowerCase() === paqueteMuerto.toLowerCase()) return 'es el mismo paquete muerto';
  if (c.deprecado) return 'también está deprecado';
  if (c.inseguro) return 'está marcado como inseguro';
  if (c.dependientes < 5 && c.descargas < 1000) return 'no tiene adopción real';

  // Relevancia por solape de keywords ESPECÍFICAS. Es el filtro que evita proponer un
  // generador de strings criptográficos para reemplazar un generador de pseudoaleatorios:
  // la búsqueda por texto sola devuelve cualquier cosa que mencione "random".
  const especificasMuerto = keywordsEspecificas(keywordsMuerto);
  if (especificasMuerto.length === 0) {
    // Sin dominio identificable, cualquier recomendación sería adivinanza.
    return 'no es del mismo dominio (el paquete original no tiene keywords que lo identifiquen)';
  }

  // El mínimo se adapta: exigir 2 a un paquete que solo tiene 1 keyword específica dejaría
  // fuera a todo el mundo por un tecnicismo.
  const minimo = Math.min(MIN_SOLAPE_KEYWORDS, especificasMuerto.length);
  const muerto = new Set(especificasMuerto);
  const solape = keywordsEspecificas(c.keywords).filter((k) => muerto.has(k)).length;
  if (solape < minimo) return 'no es del mismo dominio (pocas keywords en común)';

  return null;
}

/** Keywords de la versión instalada. Requiere el packument COMPLETO (el abreviado no las trae). */
export function keywordsDe(packument: unknown, version: string): string[] {
  const versions = asRecord(asRecord(packument)?.versions);
  if (!versions) return [];

  const entry = asRecord(versions[version]) ?? asRecord(Object.values(versions).at(-1));
  const kw = entry?.keywords;
  return Array.isArray(kw) ? kw.filter((k): k is string => typeof k === 'string') : [];
}

/** Traduce un objeto de la respuesta de búsqueda a las señales que sí sirven. */
function señalesDe(raw: unknown): SenalesCandidato | null {
  const o = asRecord(raw);
  const pkg = asRecord(o?.package);
  const nombre = pkg?.name;
  if (typeof nombre !== 'string') return null;

  const downloads = asRecord(o?.downloads);
  const flags = asRecord(o?.flags);
  const kw = pkg?.keywords;

  return {
    nombre,
    descargas: typeof downloads?.weekly === 'number' ? downloads.weekly : 0,
    dependientes: Number(o?.dependents ?? 0) || 0,
    // `package.date` es la publicación real. `updated` es el refresco del índice: inútil.
    publicado: typeof pkg?.date === 'string' ? pkg.date : '',
    keywords: Array.isArray(kw) ? kw.filter((k): k is string => typeof k === 'string') : [],
    inseguro: Number(flags?.insecure ?? 0) > 0,
    deprecado: flags?.deprecated !== undefined || pkg?.deprecated !== undefined,
  };
}

function razonDe(c: SenalesCandidato, salud: number): string {
  const dl = c.descargas.toLocaleString('es');
  const año = c.publicado.slice(0, 4);
  return `${dl} descargas por semana, ${c.dependientes} paquetes dependen de él, última publicación ${año} (salud ${salud.toFixed(2)})`;
}

/**
 * Candidatos ordenados por salud, ya filtrados. Devuelve como mucho 3, y lista vacía
 * cuando ninguno pasa el corte — decir "no hay alternativa clara" es una respuesta válida
 * y mucho mejor que rellenar el reporte con algo débil (brief §5.2.3).
 *
 * La facilidad de reemplazo NO se calcula aquí: la añade la Etapa 4, que necesita leer
 * tu código. Estos candidatos salen con `facilidad` provisional y se enriquecen después.
 */
export function rankearCandidatos(
  respuestaBusqueda: unknown,
  paqueteMuerto: string,
  keywordsMuerto: string[],
  ahora: Date = new Date(),
): Candidato[] {
  const objects = asRecord(respuestaBusqueda)?.objects;
  if (!Array.isArray(objects)) return [];

  const vivos: Candidato[] = [];
  for (const raw of objects) {
    const s = señalesDe(raw);
    if (!s) continue;
    if (descalificar(s, paqueteMuerto, keywordsMuerto)) continue;

    const salud = scoreSalud(s, ahora);
    if (salud < UMBRAL_SALUD) continue;

    vivos.push({
      nombre: s.nombre,
      score_salud: Number(salud.toFixed(3)),
      descargas_semanales: s.descargas,
      dependientes: s.dependientes,
      ultima_publicacion: s.publicado,
      facilidad: '🟡',
      compatibilidad_api: null,
      archivos_afectados: null,
      razon: razonDe(s, salud),
    });
  }

  return vivos.sort((a, b) => b.score_salud - a.score_salud).slice(0, MAX_CANDIDATOS);
}
