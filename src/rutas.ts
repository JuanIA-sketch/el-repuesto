import type { FiltroFinding } from './filtro.js';

/** Las dos rutas de arreglo del brief (§5.2). Nunca las dos a la vez. */
export type Ruta = 'actualizar_version' | 'reemplazo';

/**
 * Clasifica un hallazgo en su ruta de arreglo.
 *
 * Sale del `type` que ya trae El Filtro, sin heurísticas propias: si está vulnerable pero
 * el paquete sigue vivo, se sube; si está abandonado, se cambia. Un paquete puede estar
 * en ambas situaciones (request lo está), pero El Filtro emite un hallazgo por cada una,
 * así que la relación hallazgo→ruta se mantiene 1:1 y no hay que desempatar nada.
 */
export function rutaDe(finding: FiltroFinding): Ruta {
  return finding.type === 'deprecated' ? 'reemplazo' : 'actualizar_version';
}
