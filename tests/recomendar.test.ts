import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { recomendar } from '../src/recomendar.js';
import { renderConsola, renderJson } from '../src/reporte.js';
import type { FiltroReport } from '../src/filtro.js';
import type { RecomendacionReemplazo, RecomendacionVersion } from '../src/types.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

const AHORA = new Date('2026-07-26T00:00:00.000Z');

/** Bordes falsos: la red se inyecta, así que estos tests corren offline y son estables. */
const deps = {
  consultarPackument: async (p: string) => {
    if (p === 'mersennetwister') return fixture('packument-mersennetwister.json');
    if (p === 'mersenne-twister') return fixture('packument-mersenne-twister.json');
    if (p === 'uuid') return { 'dist-tags': { latest: '11.0.0' }, versions: { '11.0.0': {} } };
    return null;
  },
  buscar: async () => fixture('search-mersennetwister.json'),
  leerRemoto: async () => null, // sin CDN: la compatibilidad de API queda "sin dato"
  now: AHORA,
};

function reporte(findings: unknown[], extra: Partial<FiltroReport> = {}): FiltroReport {
  return {
    schemaVersion: 1,
    tool: 'el-filtro',
    generatedAt: '2026-07-26T00:00:00.000Z',
    root: 'C:/repos',
    repos: [
      {
        name: 'batallas',
        path: 'C:/Users/carlo/Desktop/Marca Personal/CLAUDE/JULIO/batallas-imperio-agentico',
        ecosystem: 'npm',
        status: 'audited',
        statusReason: null,
        findings,
      },
    ],
    ...extra,
  } as FiltroReport;
}

const vulnVitest = {
  type: 'vulnerability',
  package: 'vitest',
  installedVersions: ['2.1.9'],
  severity: 'critical',
  bucket: 'fix-now',
  direct: true,
  fixAvailable: true,
  fix: { package: 'vitest', version: '4.1.10', isSemVerMajor: true },
  explanation: 'x',
  advisory: { titles: [], urls: [], range: '<=3.2.5' },
};

const vulnPostcss = {
  ...vulnVitest,
  package: 'postcss',
  installedVersions: ['8.5.16'],
  severity: 'high',
  direct: false,
  fixAvailable: true,
  fix: null,
  advisory: { titles: [], urls: [], range: '<=8.5.17' },
};

const deprMersenne = {
  type: 'deprecated',
  package: 'mersennetwister',
  installedVersions: ['0.2.3'],
  severity: null,
  bucket: 'fix-now',
  direct: true,
  fixAvailable: false,
  fix: null,
  explanation: 'abandonado',
  advisory: {
    titles: ['Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.'],
    urls: [],
    range: '',
  },
};

describe('recomendar — criterios de aceptación del plan', () => {
  it('nº1 y nº3: vitest sale con versión exacta y postcss NO se confunde con sin_arreglo', async () => {
    const r = await recomendar(reporte([vulnVitest, vulnPostcss]), deps);
    const porPaquete = Object.fromEntries(
      r.recomendaciones.map((x) => [x.paquete, x as RecomendacionVersion]),
    );
    expect(porPaquete.vitest.certeza).toBe('version_exacta');
    expect(porPaquete.vitest.version_recomendada).toBe('4.1.10');
    expect(porPaquete.vitest.rompe_compatibilidad).toBe(true);
    expect(porPaquete.postcss.certeza).toBe('sin_version_exacta');
  });

  it('nº2: un hallazgo transitivo dice "sube vitest", no "sube esbuild"', async () => {
    const esbuild = {
      ...vulnVitest,
      package: 'esbuild',
      installedVersions: ['0.21.5'],
      direct: false,
      fix: { package: 'vitest', version: '4.1.10', isSemVerMajor: true },
    };
    const r = await recomendar(reporte([esbuild]), deps);
    const rec = r.recomendaciones[0] as RecomendacionVersion;
    expect(rec.paquete_a_subir).toBe('vitest');
    expect(rec.mensaje).toContain('vitest');
  });

  it('nº4 y nº5: mersennetwister propone mersenne-twister y ningún absurdo', async () => {
    const r = await recomendar(reporte([deprMersenne]), deps);
    const rec = r.recomendaciones[0] as RecomendacionReemplazo;
    expect(rec.ruta).toBe('reemplazo');
    expect(rec.fuente_recomendacion).toBe('registro-npm');
    const nombres = rec.candidatos.map((c) => c.nombre);
    expect(nombres).toContain('mersenne-twister');
    expect(nombres).not.toContain('crypto-random-string');
    expect(nombres).not.toContain('postgres-range');
    expect(nombres.some((n) => n.startsWith('@types/'))).toBe(false);
  });

  it('nº4: cuenta el uso real en el repo (1 archivo importa mersennetwister)', async () => {
    const r = await recomendar(reporte([deprMersenne]), deps);
    const rec = r.recomendaciones[0] as RecomendacionReemplazo;
    expect(rec.candidatos[0].archivos_afectados).toBe(1);
  });

  it('sin CDN la compatibilidad queda sin dato y la facilidad NO sube a 🟢', async () => {
    const r = await recomendar(reporte([deprMersenne]), deps);
    const rec = r.recomendaciones[0] as RecomendacionReemplazo;
    for (const c of rec.candidatos) {
      expect(c.compatibilidad_api).toBeNull();
      expect(c.facilidad).not.toBe('🟢');
    }
  });

  it('nº6: el JSON de salida tiene la forma del contrato', async () => {
    const r = await recomendar(reporte([vulnVitest, deprMersenne]), deps);
    const parsed = JSON.parse(renderJson(r));
    expect(parsed.tool).toBe('el-repuesto');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.origen.tool).toBe('el-filtro');
    expect(parsed.summary.actualizarVersion).toBe(1);
    expect(parsed.summary.reemplazo).toBe(1);
  });

  it('nº7: un reporte sin nada accionable no falla y lo dice', async () => {
    const r = await recomendar(reporte([]), deps);
    expect(r.recomendaciones).toEqual([]);
    expect(r.summary.recomendaciones).toBe(0);
    expect(renderConsola(r)).toMatch(/no hay nada que recetar/i);
  });

  it('nº8: repos que El Filtro no pudo auditar se cuentan y se avisan', async () => {
    const conRotos = reporte([vulnVitest]);
    conRotos.repos.push(
      { name: 'roto1', path: '/r1', ecosystem: 'npm', status: 'no-audit', statusReason: 'npm audit falló', findings: [] },
      { name: 'roto2', path: '/r2', ecosystem: 'npm', status: 'no-audit', statusReason: 'sin lockfile', findings: [] },
    );
    const r = await recomendar(conRotos, deps);
    expect(r.summary.reposSinAuditar).toBe(2);
    expect(renderConsola(r)).toMatch(/2 repo\(s\) no se pudieron auditar/);
  });
});

describe('recomendar — honestidad', () => {
  it('sin candidatos que pasen el corte lo declara en vez de forzar uno', async () => {
    const sinNada = {
      ...deps,
      buscar: async () => ({ objects: [] }),
    };
    const r = await recomendar(reporte([deprMersenne]), sinNada);
    const rec = r.recomendaciones[0] as RecomendacionReemplazo;
    expect(rec.sin_alternativa_clara).toBe(true);
    expect(rec.candidatos).toEqual([]);
    expect(rec.mensaje).toMatch(/no encontramos una alternativa clara/i);
  });

  it('cuando el mensaje SÍ nombra un reemplazo, usa esa fuente y no la búsqueda', async () => {
    const nodeUuid = {
      ...deprMersenne,
      package: 'node-uuid',
      advisory: { titles: ['Use uuid module instead'], urls: [], range: '' },
    };
    const r = await recomendar(reporte([nodeUuid]), deps);
    const rec = r.recomendaciones[0] as RecomendacionReemplazo;
    expect(rec.fuente_recomendacion).toBe('mensaje-deprecacion');
    expect(rec.candidatos[0].nombre).toBe('uuid');
  });

  it('un hallazgo que revienta no tumba a los demás', async () => {
    const explosivo = { ...deprMersenne, package: 'boom' };
    const deps2 = {
      ...deps,
      consultarPackument: async (p: string) => {
        if (p === 'boom') throw new Error('sin red');
        return deps.consultarPackument(p);
      },
    };
    const r = await recomendar(reporte([explosivo, vulnVitest]), deps2);
    expect(r.recomendaciones.map((x) => x.paquete)).toContain('vitest');
  });

  it('el reporte de consola declara el límite de la comparación de API', async () => {
    const r = await recomendar(reporte([deprMersenne]), deps);
    expect(renderConsola(r)).toMatch(/NOMBRES de funciones, no comportamiento/);
  });
});
