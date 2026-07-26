import { contarReposSinAuditar, hallazgosAccionables, type FiltroReport } from './filtro.js';
import { rutaDe } from './rutas.js';
import { recomendarVersion } from './version/subir.js';
import { recetarReemplazo, type DependenciasRecetar } from './reemplazo/recetar.js';
import type { Recomendacion, ReporteRepuesto } from './types.js';

const SCHEMA_VERSION = 1;

export interface OpcionesRecomendar extends DependenciasRecetar {
  onProgress?: (actual: number, total: number, paquete: string) => void;
  now?: Date;
}

/**
 * Orquestador: del reporte de El Filtro a las recomendaciones.
 *
 * Un hallazgo que falle no tumba los demás — mismo principio que el escaneo de El Filtro
 * (§7 de su brief): se prefiere un reporte parcial y honesto a ningún reporte.
 */
export async function recomendar(
  report: FiltroReport,
  opts: OpcionesRecomendar,
): Promise<ReporteRepuesto> {
  const accionables = hallazgosAccionables(report);
  const recomendaciones: Recomendacion[] = [];

  let i = 0;
  for (const { repo, finding } of accionables) {
    i += 1;
    opts.onProgress?.(i, accionables.length, finding.package);

    try {
      if (rutaDe(finding) === 'reemplazo') {
        recomendaciones.push(await recetarReemplazo(repo, finding, opts));
      } else {
        recomendaciones.push(recomendarVersion(repo.name, finding));
      }
    } catch {
      // Sin red a mitad de camino, o un hallazgo con forma rara: se omite ese y sigue el
      // resto. Callar el reporte entero por un caso sería peor.
    }
  }

  const reemplazos = recomendaciones.filter((r) => r.ruta === 'reemplazo');

  return {
    schemaVersion: SCHEMA_VERSION,
    tool: 'el-repuesto',
    generatedAt: (opts.now ?? new Date()).toISOString(),
    origen: { tool: report.tool, generatedAt: report.generatedAt, root: report.root },
    summary: {
      hallazgosLeidos: accionables.length,
      recomendaciones: recomendaciones.length,
      actualizarVersion: recomendaciones.filter((r) => r.ruta === 'actualizar_version').length,
      reemplazo: reemplazos.length,
      sinAlternativaClara: reemplazos.filter(
        (r) => r.ruta === 'reemplazo' && r.sin_alternativa_clara,
      ).length,
      reposSinAuditar: contarReposSinAuditar(report),
    },
    recomendaciones,
  };
}
