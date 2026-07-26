/**
 * BORDE de red: el registro público de npm. Sin credenciales, sin API key.
 *
 * Todo lo de aquí es inyectable para poder testear con fakes, igual que los bordes de
 * El Filtro (`ResolveDeprecation`, `RunCommand`). Nunca lanza: sin red, El Repuesto
 * recomienda menos, pero no se cae.
 */

const REGISTRO = 'https://registry.npmjs.org';
const TIMEOUT_MS = 15_000;

/** Firma inyectable: trae el packument COMPLETO de un paquete (o null si no se pudo). */
export type ConsultarPackument = (paquete: string) => Promise<unknown>;

/** Firma inyectable: busca en el registro por texto y devuelve la respuesta cruda. */
export type BuscarEnRegistro = (consulta: string) => Promise<unknown>;

async function pedirJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? await res.json() : null;
  } catch {
    return null; // sin red, DNS caído, timeout: se degrada, no se rompe
  }
}

/**
 * Packument COMPLETO, con caché en memoria.
 *
 * Deliberadamente NO se pide el abreviado (`application/vnd.npm.install-v1+json`) que usa
 * El Filtro: ese no trae `keywords`, y las keywords son justo lo que arma la consulta de
 * búsqueda de la Ruta B. Verificado: el abreviado de mersennetwister devuelve keywords
 * vacías, el completo devuelve ["rng","random","mersennetwister"].
 */
export function crearConsultorPackument(): ConsultarPackument {
  const cache = new Map<string, unknown>();
  return async (paquete) => {
    if (!cache.has(paquete)) {
      cache.set(paquete, await pedirJson(`${REGISTRO}/${encodeURIComponent(paquete)}`));
    }
    return cache.get(paquete) ?? null;
  };
}

/** Tamaño de página: se piden 25 para tener margen tras los filtros duros. */
const TAMANO_BUSQUEDA = 25;

export function crearBuscador(): BuscarEnRegistro {
  const cache = new Map<string, unknown>();
  return async (consulta) => {
    if (!cache.has(consulta)) {
      const url = `${REGISTRO}/-/v1/search?text=${encodeURIComponent(consulta)}&size=${TAMANO_BUSQUEDA}`;
      cache.set(consulta, await pedirJson(url));
    }
    return cache.get(consulta) ?? null;
  };
}

/**
 * ¿Existe este paquete en el registro y está sano para recomendarlo?
 *
 * Se usa para validar el nombre que sale del mensaje de deprecación (Ruta B paso 1): que
 * el autor escriba "use X instead" no garantiza que X exista, ni que X no esté a su vez
 * abandonado. Recomendar a ciegas lo que dice un mensaje sería confiar sin verificar.
 */
export async function existeYEstaSano(
  paquete: string,
  consultar: ConsultarPackument,
): Promise<boolean> {
  const pack = await consultar(paquete);
  if (!pack || typeof pack !== 'object') return false;

  const p = pack as Record<string, unknown>;
  const distTags = p['dist-tags'] as Record<string, unknown> | undefined;
  const ultima = typeof distTags?.latest === 'string' ? distTags.latest : null;
  if (!ultima) return false;

  const versions = p.versions as Record<string, unknown> | undefined;
  const entry = versions?.[ultima] as Record<string, unknown> | undefined;
  // Si su última versión está deprecada, no es reemplazo de nada.
  return !(typeof entry?.deprecated === 'string' && entry.deprecated.trim() !== '');
}
