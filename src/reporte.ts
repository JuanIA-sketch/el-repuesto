import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import picocolors from 'picocolors';
import type { RecomendacionReemplazo, RecomendacionVersion, ReporteRepuesto } from './types.js';

/** Salida JSON máquina-legible. */
export function renderJson(reporte: ReporteRepuesto): string {
  return JSON.stringify(reporte, null, 2);
}

const CABECERA = [
  '╔════════════════════════════════════════╗',
  '║   🔧  EL REPUESTO — Qué hacer          ║',
  '╚════════════════════════════════════════╝',
].join('\n');

/**
 * Etiqueta de certeza en lenguaje simple. `sin_version_exacta` se presenta como lo bueno
 * que es: el arreglo más barato del reporte, no un caso dudoso.
 */
const ETIQUETA_CERTEZA: Record<RecomendacionVersion['certeza'], string> = {
  version_exacta: 'versión exacta',
  sin_version_exacta: 'basta actualizar',
  sin_arreglo: 'sin versión segura',
  reporte_antiguo: 'dato no disponible',
};

function lineaVersion(r: RecomendacionVersion, pc: ReturnType<typeof picocolors.createColors>): string[] {
  const actual = r.version_actual ? ` ${r.version_actual}` : '';
  const destino =
    r.version_recomendada && r.paquete_a_subir
      ? ` → ${r.paquete_a_subir}@${r.version_recomendada}`
      : '';
  const lineas = [
    `  • ${r.repo} › ${r.paquete}${actual}${destino}  ${pc.dim(`(${ETIQUETA_CERTEZA[r.certeza]})`)}`,
    pc.dim(`      ${r.mensaje}`),
  ];
  if (r.rompe_compatibilidad) {
    lineas.push(pc.yellow('      ⚠ salto de versión mayor: puede romper'));
  }
  return lineas;
}

function lineaReemplazo(
  r: RecomendacionReemplazo,
  pc: ReturnType<typeof picocolors.createColors>,
): string[] {
  const actual = r.version_actual ? ` ${r.version_actual}` : '';
  const lineas = [`  • ${r.repo} › ${r.paquete}${actual}  ${pc.dim('(abandonado)')}`];
  lineas.push(pc.dim(`      ${r.mensaje}`));

  if (r.sin_alternativa_clara) {
    lineas.push(pc.yellow('      (ninguna alternativa pasó el corte)'));
    return lineas;
  }

  for (const c of r.candidatos) {
    lineas.push(`      ${c.facilidad} ${c.nombre}  ${pc.dim(`salud ${c.score_salud.toFixed(2)}`)}`);
    lineas.push(pc.dim(`          ${c.razon}`));
  }
  return lineas;
}

/** Resumen humano, mismo lenguaje visual 🟢🟡🔴 que El Filtro. */
export function renderConsola(reporte: ReporteRepuesto, opts: { colors?: boolean } = {}): string {
  const pc = picocolors.createColors(opts.colors ?? false);
  const s = reporte.summary;
  const lineas: string[] = [CABECERA, ''];

  lineas.push(`Reporte de El Filtro: ${reporte.origen.root}`);
  lineas.push(
    `Hallazgos leídos: ${s.hallazgosLeidos}  ·  recomendaciones: ${s.recomendaciones}`,
  );

  const versiones = reporte.recomendaciones.filter(
    (r): r is RecomendacionVersion => r.ruta === 'actualizar_version',
  );
  const reemplazos = reporte.recomendaciones.filter(
    (r): r is RecomendacionReemplazo => r.ruta === 'reemplazo',
  );

  lineas.push('', pc.cyan(`⬆  SUBE DE VERSIÓN (${versiones.length})`));
  if (versiones.length === 0) lineas.push(pc.dim('  (nada que actualizar)'));
  for (const r of versiones) lineas.push(...lineaVersion(r, pc));

  lineas.push('', pc.magenta(`🔄 CAMBIA DE PAQUETE (${reemplazos.length})`));
  if (reemplazos.length === 0) lineas.push(pc.dim('  (nada que reemplazar)'));
  for (const r of reemplazos) lineas.push(...lineaReemplazo(r, pc));

  if (s.sinAlternativaClara > 0) {
    lineas.push(
      '',
      pc.dim(`${s.sinAlternativaClara} paquete(s) sin alternativa clara — se dice, no se inventa.`),
    );
  }

  // Criterio de honestidad: si El Filtro no pudo auditar repos, la cobertura de estas
  // recomendaciones es menor de lo que parece y hay que decirlo.
  if (s.reposSinAuditar > 0) {
    lineas.push(
      '',
      pc.yellow(
        `⚠ ${s.reposSinAuditar} repo(s) no se pudieron auditar en el escaneo original: ` +
          'estas recomendaciones no los cubren.',
      ),
    );
  }

  if (s.recomendaciones === 0) {
    lineas.push('', 'No hay nada que recetar: ningún hallazgo npm accionable en este reporte.');
  }

  // El límite de la herramienta, dicho en el propio reporte (brief §9).
  if (reemplazos.some((r) => r.candidatos.length > 0)) {
    lineas.push(
      '',
      pc.dim(
        'La compatibilidad de API compara NOMBRES de funciones, no comportamiento: ' +
          'es una guía de cuánto reescribirías, no una garantía de que el cambio sea seguro.',
      ),
    );
  }

  return lineas.join('\n');
}

function timestampSeguro(iso: string): string {
  return iso.replace(/[:.]/g, '-'); // Windows no permite ':' en nombres de archivo
}

/** Escribe el reporte en `<baseDir>/.el-repuesto/recomendaciones-<ts>.json`. */
export function escribirReporte(reporte: ReporteRepuesto, baseDir: string): string {
  const dir = join(baseDir, '.el-repuesto');
  mkdirSync(dir, { recursive: true });
  const archivo = join(dir, `recomendaciones-${timestampSeguro(reporte.generatedAt)}.json`);
  writeFileSync(archivo, renderJson(reporte));
  return archivo;
}
