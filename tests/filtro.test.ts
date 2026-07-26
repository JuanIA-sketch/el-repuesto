import { describe, it, expect } from 'vitest';
import {
  parseFiltroReport,
  hallazgosAccionables,
  contarReposSinAuditar,
  type FiltroReport,
} from '../src/filtro.js';
import { rutaDe } from '../src/rutas.js';

function reporte(over: Partial<FiltroReport> = {}): FiltroReport {
  return {
    schemaVersion: 1,
    tool: 'el-filtro',
    generatedAt: '2026-07-26T00:00:00.000Z',
    root: '/repos',
    repos: [],
    ...over,
  } as FiltroReport;
}

const findingVuln = {
  type: 'vulnerability' as const,
  package: 'vitest',
  installedVersions: ['2.1.9'],
  severity: 'critical',
  bucket: 'fix-now' as const,
  direct: true,
  fixAvailable: true,
  fix: { package: 'vitest', version: '4.1.10', isSemVerMajor: true },
  explanation: 'x',
  advisory: { titles: [], urls: [], range: '<=3.2.5' },
};

describe('parseFiltroReport', () => {
  it('acepta un reporte válido de El Filtro', () => {
    expect(parseFiltroReport(reporte()).tool).toBe('el-filtro');
  });

  it('rechaza un JSON que no es reporte de El Filtro, diciendo cómo generar uno', () => {
    expect(() => parseFiltroReport({ tool: 'otra-cosa', repos: [] })).toThrow(/el-filtro --path/);
    expect(() => parseFiltroReport({ name: 'mi-app', version: '1.0.0' })).toThrow(/El Filtro/);
  });

  it('rechaza basura sin reventar con un stack ilegible', () => {
    expect(() => parseFiltroReport(null)).toThrow(/JSON/);
    expect(() => parseFiltroReport('texto')).toThrow(/JSON/);
    expect(() => parseFiltroReport({ tool: 'el-filtro' })).toThrow(/repos/);
  });
});

describe('hallazgosAccionables', () => {
  const r = reporte({
    repos: [
      { name: 'npm-ok', path: '/repos/npm-ok', ecosystem: 'npm', status: 'audited', statusReason: null, findings: [findingVuln] },
      { name: 'pip-repo', path: '/repos/pip', ecosystem: 'pip', status: 'audited', statusReason: null, findings: [{ ...findingVuln, package: 'jinja2' }] },
      { name: 'roto', path: '/repos/roto', ecosystem: 'npm', status: 'no-audit', statusReason: 'sin lockfile', findings: [] },
      { name: 'docs', path: '/repos/docs', ecosystem: 'none', status: 'not-applicable', statusReason: null, findings: [] },
    ],
  });

  it('solo devuelve hallazgos npm de repos que sí se auditaron (v1 es npm-only)', () => {
    const out = hallazgosAccionables(r);
    expect(out).toHaveLength(1);
    expect(out[0].finding.package).toBe('vitest');
    expect(out[0].repo.name).toBe('npm-ok');
  });

  it('un reporte sin nada accionable devuelve lista vacía, no lanza', () => {
    expect(hallazgosAccionables(reporte())).toEqual([]);
  });

  it('tolera un repo sin la lista de findings', () => {
    const raro = reporte({
      repos: [{ name: 'x', path: '/x', ecosystem: 'npm', status: 'audited', statusReason: null } as never],
    });
    expect(() => hallazgosAccionables(raro)).not.toThrow();
  });
});

describe('contarReposSinAuditar — criterio de aceptación nº8', () => {
  it('cuenta los repos que El Filtro no pudo auditar', () => {
    // Pasa de verdad: durante el desarrollo el endpoint advisories/bulk de npm falló
    // y varios repos quedaron no-audit. Callarlo haría creer que la cobertura fue total.
    const r = reporte({
      repos: [
        { name: 'a', path: '/a', ecosystem: 'npm', status: 'audited', statusReason: null, findings: [] },
        { name: 'b', path: '/b', ecosystem: 'npm', status: 'no-audit', statusReason: 'npm audit falló', findings: [] },
        { name: 'c', path: '/c', ecosystem: 'npm', status: 'no-audit', statusReason: 'sin lockfile', findings: [] },
        { name: 'd', path: '/d', ecosystem: 'none', status: 'not-applicable', statusReason: null, findings: [] },
      ],
    });
    expect(contarReposSinAuditar(r)).toBe(2);
  });

  it('no cuenta como fallo un repo que simplemente no aplica', () => {
    const r = reporte({
      repos: [{ name: 'd', path: '/d', ecosystem: 'none', status: 'not-applicable', statusReason: null, findings: [] }],
    });
    expect(contarReposSinAuditar(r)).toBe(0);
  });
});

describe('rutaDe — clasificador de las dos rutas (brief §5.2)', () => {
  it('vulnerable → Ruta A (subir de versión)', () => {
    expect(rutaDe(findingVuln)).toBe('actualizar_version');
  });

  it('abandonado → Ruta B (buscar reemplazo)', () => {
    expect(rutaDe({ ...findingVuln, type: 'deprecated' })).toBe('reemplazo');
  });

  it('nunca las dos a la vez: la ruta sale del tipo de hallazgo, no de heurísticas', () => {
    // Un paquete puede estar vulnerable Y abandonado (request lo está). El Filtro emite
    // DOS hallazgos separados, y cada uno toma su ruta. Eso mantiene el 1:1.
    expect(rutaDe({ ...findingVuln, package: 'request', type: 'vulnerability' })).toBe('actualizar_version');
    expect(rutaDe({ ...findingVuln, package: 'request', type: 'deprecated' })).toBe('reemplazo');
  });
});
