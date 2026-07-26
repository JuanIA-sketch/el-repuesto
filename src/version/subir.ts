import type { FiltroFinding } from '../filtro.js';
import type { Certeza, RecomendacionVersion } from '../types.js';

/**
 * Ruta A del brief (§5.2): el paquete sigue mantenido, el arreglo es subir de versión.
 *
 * Todo sale de `npm audit`, que es dato objetivo, no inferencia. La única decisión real
 * aquí es NO colapsar los tres estados de `fixAvailable`, porque significan cosas muy
 * distintas y confundirlos da consejos falsos en direcciones opuestas.
 */

/**
 * Los tres estados de `fixAvailable` (más el cuarto de reportes viejos).
 *
 * OJO con el orden: se pregunta primero por la AUSENCIA del campo `fix`. Un reporte
 * anterior al campo trae `fixAvailable: true` sin `fix`, que es indistinguible del caso
 * de postcss si solo se mira el booleano. `buildReport` de El Filtro normaliza `fix` a
 * null justamente para que esta distinción sea posible.
 */
function clasificarCerteza(f: FiltroFinding): Certeza {
  if (!('fix' in f)) return 'reporte_antiguo';
  if (f.fix) return 'version_exacta';
  return f.fixAvailable ? 'sin_version_exacta' : 'sin_arreglo';
}

function mensajeVersionExacta(f: FiltroFinding, fix: NonNullable<FiltroFinding['fix']>): string {
  const transitivo = fix.package !== f.package;
  const aviso = fix.isSemVerMajor
    ? ` Es un salto de versión mayor, así que puede romper: revisa sus notas de cambio antes de darlo por hecho.`
    : '';

  if (transitivo) {
    // El caso que más confunde: el paquete roto no es el que hay que tocar.
    return (
      `${f.package} tiene el fallo, pero no lo instalaste tú: lo arrastra ${fix.package}. ` +
      `Sube ${fix.package} a ${fix.version} y ${f.package} se arregla solo.${aviso}`
    );
  }
  return `Sube ${fix.package} a ${fix.version}.${aviso}`;
}

/**
 * `fixAvailable: true` sin objeto. npm no nombra versión porque no hace falta cambiar
 * nada de lo declarado: el arreglo cabe dentro del rango que ya tienes en package.json.
 * Es el arreglo más barato del reporte y el mensaje tiene que decirlo así — tratarlo
 * como "revísalo a mano" sería el peor error posible.
 */
function mensajeSinVersionExacta(f: FiltroFinding): string {
  return (
    `Hay arreglo y no necesitas tocar tu package.json: se resuelve dentro del rango que ya ` +
    `declaras. Corre \`npm update ${f.package}\`. npm no nombró una versión porque no hace ` +
    `falta cambiar la declarada.`
  );
}

function mensajeSinArreglo(f: FiltroFinding): string {
  return (
    `No hay versión segura publicada de ${f.package}: subir de versión no te saca de esta. ` +
    `La salida es reemplazarlo o aislarlo.`
  );
}

const MENSAJE_REPORTE_ANTIGUO =
  'Este reporte viene de una versión anterior de El Filtro, que no guardaba la versión ' +
  'objetivo. Vuelve a correr El Filtro para obtener el dato exacto — no lo adivinamos.';

/**
 * Convierte UN hallazgo de vulnerabilidad de El Filtro en una recomendación de versión.
 * Función pura: no toca red ni disco.
 */
export function recomendarVersion(repo: string, f: FiltroFinding): RecomendacionVersion {
  const certeza = clasificarCerteza(f);
  const fix = f.fix ?? null;

  const base = {
    ruta: 'actualizar_version' as const,
    repo,
    paquete: f.package,
    problema: 'vulnerable' as const,
    version_actual: f.installedVersions[0] ?? null,
    certeza,
    rango_vulnerable: f.advisory?.range ?? '',
    fuente_recomendacion: 'npm-audit-fix-available',
    urls: f.advisory?.urls ?? [],
  };

  switch (certeza) {
    case 'version_exacta':
      return {
        ...base,
        paquete_a_subir: fix!.package,
        version_recomendada: fix!.version,
        rompe_compatibilidad: fix!.isSemVerMajor,
        mensaje: mensajeVersionExacta(f, fix!),
      };

    case 'sin_version_exacta':
      return {
        ...base,
        // Sí sabemos QUÉ actualizar (este mismo paquete), solo no a qué versión exacta.
        paquete_a_subir: f.package,
        version_recomendada: null,
        rompe_compatibilidad: null,
        mensaje: mensajeSinVersionExacta(f),
      };

    case 'sin_arreglo':
      return {
        ...base,
        paquete_a_subir: null,
        version_recomendada: null,
        rompe_compatibilidad: null,
        mensaje: mensajeSinArreglo(f),
      };

    case 'reporte_antiguo':
      return {
        ...base,
        paquete_a_subir: null,
        version_recomendada: null,
        rompe_compatibilidad: null,
        mensaje: MENSAJE_REPORTE_ANTIGUO,
      };
  }
}
