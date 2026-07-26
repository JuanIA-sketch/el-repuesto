import type { Facilidad } from '../types.js';

/** Orden de severidad: cuanto más alto, más difícil. */
const PESO: Record<Facilidad, number> = { '🟢': 0, '🟡': 1, '🔴': 2 };

/**
 * Combina las dos señales tomando el PEOR caso (brief §5.3).
 *
 * Si cualquiera de las dos sale difícil, el reemplazo se cuenta como difícil. Promediarlas
 * escondería el problema: una API idéntica no sirve de nada si tienes que tocar 40
 * archivos, y un solo archivo tampoco ayuda si no hay ni una función en común.
 */
export function combinarFacilidad(uso: Facilidad, api: Facilidad): Facilidad {
  return PESO[uso] >= PESO[api] ? uso : api;
}
