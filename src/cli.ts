import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { parseFiltroReport } from './filtro.js';
import { recomendar } from './recomendar.js';
import { crearBuscador, crearConsultorPackument } from './reemplazo/registro.js';
import { crearLectorRemoto } from './reemplazo/recetar.js';
import { escribirReporte, renderConsola, renderJson } from './reporte.js';

// \r vuelve al inicio de línea; ESC[K borra hasta el final.
const LIMPIAR_LINEA = '\r' + String.fromCharCode(27) + '[K';

const program = new Command();

program
  .name('el-repuesto')
  .description('🔧 Lee el reporte de El Filtro y te dice qué hacer: subir de versión o cambiar de paquete')
  .version('0.1.1')
  .requiredOption('--reporte <ruta>', 'reporte JSON generado por El Filtro')
  .option('--json', 'salida JSON máquina-legible, sin colores ni progreso')
  .option('--no-write', 'no escribir el reporte a disco')
  .option('--salida <ruta>', 'carpeta donde escribir el reporte', '.')
  .action(async (opts: { reporte: string; json?: boolean; write?: boolean; salida: string }) => {
    const ruta = resolve(opts.reporte);

    let report;
    try {
      report = parseFiltroReport(JSON.parse(readFileSync(ruta, 'utf8')));
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      throw new Error(`No se pudo leer el reporte de El Filtro (${ruta}): ${motivo}`);
    }

    const reporte = await recomendar(report, {
      consultarPackument: crearConsultorPackument(),
      buscar: crearBuscador(),
      leerRemoto: crearLectorRemoto(),
      onProgress: opts.json
        ? undefined
        : (actual, total, paquete) => {
            // Progreso en stderr para no ensuciar stdout.
            process.stderr.write(`${LIMPIAR_LINEA}  Analizando ${actual}/${total}: ${paquete}...`);
          },
    });

    if (!opts.json) process.stderr.write(LIMPIAR_LINEA);

    if (opts.json) {
      console.log(renderJson(reporte));
    } else {
      console.log(renderConsola(reporte, { colors: process.stdout.isTTY === true }));
    }

    if (opts.write !== false) {
      const escrito = escribirReporte(reporte, resolve(opts.salida));
      if (!opts.json) console.log(`\nReporte guardado en: ${escrito}`);
    }
  });

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
