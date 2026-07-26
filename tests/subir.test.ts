import { describe, it, expect } from 'vitest';
import { recomendarVersion } from '../src/version/subir.js';
import type { FiltroFinding } from '../src/filtro.js';

/**
 * Los hallazgos de estos tests son formas REALES capturadas de `npm audit --json` en
 * JULIO/ALARMA (ver tests/fixtures/). Los tres estados de `fixAvailable` no son teóricos:
 * los tres aparecen en ese mismo repo, en la misma corrida.
 */
function hallazgo(over: Partial<FiltroFinding> = {}): FiltroFinding {
  return {
    type: 'vulnerability',
    package: 'vitest',
    installedVersions: ['2.1.9'],
    severity: 'critical',
    bucket: 'fix-now',
    direct: true,
    fixAvailable: true,
    fix: { package: 'vitest', version: '4.1.10', isSemVerMajor: true },
    explanation: 'explicación simple',
    advisory: { titles: ['t'], urls: ['https://github.com/advisories/GHSA-x'], range: '<=3.2.5' },
    ...over,
  };
}

describe('recomendarVersion — certeza `version_exacta`', () => {
  it('receta la versión exacta que npm nombró', () => {
    const r = recomendarVersion('ALARMA', hallazgo());
    expect(r.certeza).toBe('version_exacta');
    expect(r.paquete_a_subir).toBe('vitest');
    expect(r.version_recomendada).toBe('4.1.10');
    expect(r.version_actual).toBe('2.1.9');
  });

  it('avisa que el salto es de versión mayor y puede romper', () => {
    const r = recomendarVersion('ALARMA', hallazgo());
    expect(r.rompe_compatibilidad).toBe(true);
    expect(r.mensaje).toMatch(/mayor|romper/i);
  });

  it('no avisa de ruptura cuando el salto no es mayor', () => {
    const r = recomendarVersion('mi-app', hallazgo({
      package: 'axios',
      installedVersions: ['0.21.1'],
      fix: { package: 'axios', version: '0.21.4', isSemVerMajor: false },
    }));
    expect(r.rompe_compatibilidad).toBe(false);
    expect(r.mensaje).not.toMatch(/puede romper/i);
  });

  it('CASO TRANSITIVO: nombra el paquete PADRE a subir, no el vulnerable', () => {
    // esbuild es vulnerable, pero no está en el package.json de nadie: lo arrastra vitest.
    // Recomendar "sube esbuild" mandaría a tocar algo que no se puede tocar.
    const r = recomendarVersion('ALARMA', hallazgo({
      package: 'esbuild',
      installedVersions: ['0.21.5'],
      direct: false,
      fix: { package: 'vitest', version: '4.1.10', isSemVerMajor: true },
      advisory: { titles: ['t'], urls: [], range: '<=0.24.2' },
    }));
    expect(r.paquete).toBe('esbuild');
    expect(r.paquete_a_subir).toBe('vitest');
    expect(r.mensaje).toContain('vitest');
    expect(r.mensaje).toMatch(/esbuild/);
    // El mensaje tiene que explicar POR QUÉ se sube otro paquete.
    expect(r.mensaje).toMatch(/viene de|lo arrastra|a través de/i);
  });
});

describe('recomendarVersion — certeza `sin_version_exacta` (el caso de postcss)', () => {
  // Capturado real en ALARMA: postcss 8.5.16, transitiva (la arrastra vite),
  // rango <=8.5.17, fixAvailable: true PELADO (sin objeto).
  const postcss = hallazgo({
    package: 'postcss',
    installedVersions: ['8.5.16'],
    severity: 'high',
    direct: false,
    fixAvailable: true,
    fix: null,
    advisory: { titles: ['PostCSS path traversal'], urls: ['https://github.com/advisories/GHSA-r28c'], range: '<=8.5.17' },
  });

  it('lo marca `sin_version_exacta`, NO `sin_arreglo`', () => {
    const r = recomendarVersion('ALARMA', postcss);
    expect(r.certeza).toBe('sin_version_exacta');
    expect(r.certeza).not.toBe('sin_arreglo');
  });

  it('lo presenta como lo que es: el arreglo MÁS FÁCIL, no uno dudoso', () => {
    const r = recomendarVersion('ALARMA', postcss);
    // Nada de "revísalo a mano" ni "no se pudo determinar": eso es el mensaje de sin_arreglo.
    expect(r.mensaje).not.toMatch(/manual|a mano|no se pudo|revisa el aviso/i);
    expect(r.mensaje).toMatch(/npm update postcss/);
    expect(r.mensaje).toMatch(/no necesitas|sin tocar/i);
  });

  it('no inventa versión objetivo, pero sí conserva el rango vulnerable como contexto', () => {
    const r = recomendarVersion('ALARMA', postcss);
    expect(r.version_recomendada).toBeNull();
    expect(r.paquete_a_subir).toBe('postcss');
    expect(r.rompe_compatibilidad).toBeNull();
    expect(r.rango_vulnerable).toBe('<=8.5.17');
  });
});

describe('recomendarVersion — certeza `sin_arreglo`', () => {
  const request = hallazgo({
    package: 'request',
    installedVersions: ['2.88.2'],
    direct: true,
    fixAvailable: false,
    fix: null,
    advisory: { titles: ['SSRF in Request'], urls: ['https://github.com/advisories/GHSA-p8p7'], range: '*' },
  });

  it('dice claramente que no hay versión segura publicada', () => {
    const r = recomendarVersion('mi-app', request);
    expect(r.certeza).toBe('sin_arreglo');
    expect(r.version_recomendada).toBeNull();
    expect(r.paquete_a_subir).toBeNull();
    expect(r.mensaje).toMatch(/no hay versión segura/i);
  });

  it('apunta al reemplazo como salida, ya que subir no sirve', () => {
    const r = recomendarVersion('mi-app', request);
    expect(r.mensaje).toMatch(/reemplaz|cambiar/i);
  });

  it('conserva las urls del advisory para poder verificarlo', () => {
    const r = recomendarVersion('mi-app', request);
    expect(r.urls).toContain('https://github.com/advisories/GHSA-p8p7');
  });
});

describe('recomendarVersion — certeza `reporte_antiguo`', () => {
  it('cuando falta el campo `fix` no adivina: pide volver a correr El Filtro', () => {
    const { fix, ...sinFix } = hallazgo();
    const r = recomendarVersion('ALARMA', sinFix as FiltroFinding);
    expect(r.certeza).toBe('reporte_antiguo');
    expect(r.version_recomendada).toBeNull();
    expect(r.mensaje).toMatch(/versión anterior de El Filtro|vuelve a correr/i);
  });

  it('distingue campo AUSENTE (reporte viejo) de campo en null (sin versión objetivo)', () => {
    const { fix, ...sinFix } = hallazgo();
    expect(recomendarVersion('x', sinFix as FiltroFinding).certeza).toBe('reporte_antiguo');
    expect(recomendarVersion('x', hallazgo({ fix: null })).certeza).toBe('sin_version_exacta');
  });
});

describe('recomendarVersion — forma común', () => {
  it('siempre trae repo, ruta y fuente trazable', () => {
    const r = recomendarVersion('ALARMA', hallazgo());
    expect(r.repo).toBe('ALARMA');
    expect(r.ruta).toBe('actualizar_version');
    expect(r.problema).toBe('vulnerable');
    expect(r.fuente_recomendacion).toBe('npm-audit-fix-available');
  });

  it('tolera un hallazgo sin versión instalada', () => {
    const r = recomendarVersion('x', hallazgo({ installedVersions: [] }));
    expect(r.version_actual).toBeNull();
  });
});
