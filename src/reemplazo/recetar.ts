import { readFileSync } from 'node:fs';
import type { Candidato, RecomendacionReemplazo } from '../types.js';
import type { FiltroFinding, FiltroRepo } from '../filtro.js';
import { extraerReemplazo } from './mensaje.js';
import { keywordsDe, keywordsEspecificas, rankearCandidatos } from './buscar.js';
import { existeYEstaSano, type BuscarEnRegistro, type ConsultarPackument } from './registro.js';
import { archivosQueUsan, contarArchivosQueUsan, facilidadPorUso } from '../facilidad/uso.js';
import {
  compatibilidadApi,
  facilidadPorApi,
  superficieOfrecida,
  superficieUsada,
} from '../facilidad/api.js';
import { combinarFacilidad } from '../facilidad/combinar.js';
import { resolverEntrada, urlDeArchivo } from '../facilidad/entrada.js';

/**
 * Ruta B completa (brief §5.2): del hallazgo de paquete abandonado a candidatos concretos
 * con su score de facilidad.
 *
 * Orden de intentos, de más a menos confiable:
 *   1. El mensaje de deprecación nombra un reemplazo → se valida contra el registro.
 *   2. Búsqueda por keywords + ranking por números duros.
 *   3. Nada decente → se dice, en vez de forzar una recomendación floja.
 */

/** Firma inyectable para traer el texto de un archivo del CDN (borde de red). */
export type LeerArchivoRemoto = (url: string) => Promise<string | null>;

export function crearLectorRemoto(): LeerArchivoRemoto {
  const cache = new Map<string, string | null>();
  return async (url) => {
    if (!cache.has(url)) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        cache.set(url, res.ok ? await res.text() : null);
      } catch {
        cache.set(url, null);
      }
    }
    return cache.get(url) ?? null;
  };
}

export interface DependenciasRecetar {
  consultarPackument: ConsultarPackument;
  buscar: BuscarEnRegistro;
  leerRemoto: LeerArchivoRemoto;
}

/**
 * Enriquece un candidato con el score de facilidad: uso en tu código + compatibilidad de
 * API, combinados por el peor caso. Sin datos suficientes degrada a 🟡 con la razón dicha,
 * nunca a 🟢 (brief §9: esto es una heurística de nombres, no una garantía).
 */
async function conFacilidad(
  candidato: Candidato,
  usada: string[],
  archivos: number,
  deps: DependenciasRecetar,
): Promise<Candidato> {
  const fUso = facilidadPorUso(archivos);

  const pack = await deps.consultarPackument(candidato.nombre);
  const entrada = resolverEntrada(pack);
  const fuente = entrada
    ? await deps.leerRemoto(urlDeArchivo(candidato.nombre, entrada.version, entrada.archivo))
    : null;

  const ofrecida = fuente ? superficieOfrecida(fuente, entrada!.archivo) : [];
  const compat = compatibilidadApi(usada, ofrecida);
  const fApi = facilidadPorApi(compat);
  const facilidad = combinarFacilidad(fUso, fApi);

  const detalleApi =
    compat === null
      ? 'no se pudo comparar su API (se reporta como medio, no como fácil)'
      : `${Math.round(compat * 100)}% de las funciones que usas existen con el mismo nombre`;

  return {
    ...candidato,
    facilidad,
    compatibilidad_api: compat,
    archivos_afectados: archivos,
    razon: `${archivos} archivo(s) lo usan, ${detalleApi}. ${candidato.razon}`,
  };
}

const SIN_ALTERNATIVA =
  'No encontramos una alternativa clara para este paquete. Preferimos decirlo a ' +
  'recomendarte algo débil: revísalo a mano o considera absorber el código que necesitas.';

/**
 * Convierte UN hallazgo de paquete abandonado en una recomendación de reemplazo.
 * Es el único punto de El Repuesto que toca red, y siempre a través de `deps`.
 */
export async function recetarReemplazo(
  repo: FiltroRepo,
  f: FiltroFinding,
  deps: DependenciasRecetar,
): Promise<RecomendacionReemplazo> {
  const mensajeDeprecacion = f.advisory?.titles[0] ?? '';
  const version = f.installedVersions[0] ?? null;

  // Lo que tu código realmente le pide a este paquete. Se calcula una vez y sirve para
  // evaluar a todos los candidatos.
  const archivos = archivosQueUsan(repo.path, f.package);
  const usada = [
    ...new Set(
      archivos.flatMap((a) => {
        try {
          return superficieUsada(readFileSync(a, 'utf8'), f.package);
        } catch {
          return [];
        }
      }),
    ),
  ];
  const totalArchivos = contarArchivosQueUsan(repo.path, f.package);

  const base = {
    ruta: 'reemplazo' as const,
    repo: repo.name,
    paquete: f.package,
    problema: 'abandonado' as const,
    version_actual: version,
    mensaje_deprecacion: mensajeDeprecacion,
  };

  // ── Intento 1: el propio autor nombra el reemplazo ──────────────────────────────
  const nombrado = extraerReemplazo(mensajeDeprecacion, f.package);
  if (nombrado && (await existeYEstaSano(nombrado, deps.consultarPackument))) {
    const candidato: Candidato = {
      nombre: nombrado,
      score_salud: 1,
      descargas_semanales: 0,
      dependientes: 0,
      ultima_publicacion: '',
      facilidad: '🟡',
      compatibilidad_api: null,
      archivos_afectados: null,
      razon: 'lo nombra el propio mensaje de deprecación (la fuente más confiable)',
    };
    return {
      ...base,
      fuente_recomendacion: 'mensaje-deprecacion',
      candidatos: [await conFacilidad(candidato, usada, totalArchivos, deps)],
      sin_alternativa_clara: false,
      mensaje: `Quien mantiene ${f.package} señala ${nombrado} como reemplazo.`,
    };
  }

  // ── Intento 2: búsqueda + ranking por números duros ─────────────────────────────
  const pack = await deps.consultarPackument(f.package);
  const keywords = keywordsDe(pack, version ?? '');
  // La consulta se arma SOLO con las keywords que identifican un dominio. Incluir las
  // genéricas ("util", "simple") arrastra la búsqueda hacia cualquier utilidad de npm:
  // con ellas, buscar el reemplazo de `request` devolvía parsers de markdown.
  const especificas = keywordsEspecificas(keywords);
  if (especificas.length > 0) {
    const respuesta = await deps.buscar(especificas.slice(0, 5).join(' '));
    const ranking = rankearCandidatos(respuesta, f.package, keywords);
    if (ranking.length > 0) {
      const candidatos = await Promise.all(
        ranking.map((c) => conFacilidad(c, usada, totalArchivos, deps)),
      );
      return {
        ...base,
        fuente_recomendacion: 'registro-npm',
        candidatos,
        sin_alternativa_clara: false,
        mensaje:
          `${f.package} está abandonado y su mensaje no señala reemplazo. ` +
          `Estos ${candidatos.length} salieron del registro npm, ordenados por salud. ` +
          `Ojo: el más sano y el más fácil de adoptar no siempre son el mismo.`,
      };
    }
  }

  // ── Intento 3: honestidad ───────────────────────────────────────────────────────
  return {
    ...base,
    fuente_recomendacion: 'ninguna',
    candidatos: [],
    sin_alternativa_clara: true,
    mensaje: SIN_ALTERNATIVA,
  };
}
