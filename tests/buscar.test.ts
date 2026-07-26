import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  scoreSalud,
  descalificar,
  rankearCandidatos,
  keywordsDe,
  keywordsEspecificas,
  UMBRAL_SALUD,
} from '../src/reemplazo/buscar.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

/** Respuestas REALES del registro npm, capturadas — no inventadas. */
const busqueda = fixture('search-mersennetwister.json') as { objects: unknown[] };
const packMersennetwister = fixture('packument-mersennetwister.json');

// Fecha fija: los scores dependen de la antigüedad, así que sin esto los tests
// cambiarían de resultado cada día.
const AHORA = new Date('2026-07-26T00:00:00.000Z');

describe('keywordsDe — la consulta sale del packument, no del aire', () => {
  it('lee las keywords de la versión instalada (packument COMPLETO)', () => {
    // El packument ABREVIADO que usa El Filtro no trae keywords. Este detalle obliga a
    // pedir el completo y es fácil de romper sin darse cuenta.
    expect(keywordsDe(packMersennetwister, '0.2.3')).toEqual(['rng', 'random', 'mersennetwister']);
  });

  it('cae a la última versión si la instalada no está en el packument', () => {
    expect(keywordsDe(packMersennetwister, '99.0.0').length).toBeGreaterThan(0);
  });

  it('sin keywords devuelve lista vacía, no revienta', () => {
    expect(keywordsDe({ versions: { '1.0.0': {} } }, '1.0.0')).toEqual([]);
    expect(keywordsDe(null, '1.0.0')).toEqual([]);
  });
});

describe('keywordsEspecificas — las genéricas no establecen dominio', () => {
  it('CASO REAL request: descarta util/utility/simple y deja http', () => {
    // Encontrado en el e2e: las keywords de request son ["http","simple","util","utility"].
    // Como TODO helper de npm se etiqueta "util"+"utility", el solape de 2 se cumplía con
    // paquetes de otro planeta y El Repuesto proponía parsers de markdown para un cliente
    // HTTP. Las palabras que todo el mundo usa no dicen de qué es un paquete.
    expect(keywordsEspecificas(['http', 'simple', 'util', 'utility'])).toEqual(['http']);
  });

  it('CASO REAL mersennetwister: sus keywords son todas específicas', () => {
    expect(keywordsEspecificas(['rng', 'random', 'mersennetwister']))
      .toEqual(['rng', 'random', 'mersennetwister']);
  });

  it('normaliza a minúsculas y quita duplicados', () => {
    expect(keywordsEspecificas(['HTTP', 'http', 'Util'])).toEqual(['http']);
  });

  it('un paquete solo con keywords genéricas se queda sin dominio', () => {
    expect(keywordsEspecificas(['util', 'library', 'javascript', 'node'])).toEqual([]);
  });
});

describe('scoreSalud — reconstruido sobre números duros', () => {
  // Los scores de la API (quality/popularity/maintenance) devuelven SIEMPRE 1/1/1.
  // Verificado en 60 resultados de 3 consultas. Por eso el score se calcula aquí.
  it('premia adopción masiva aunque el paquete sea viejo', () => {
    // mersenne-twister: 880.958 dl/semana, 191 dependientes, publicado 2016-08-01.
    const s = scoreSalud(
      { descargas: 880958, dependientes: 191, publicado: '2016-08-01T08:43:48.858Z' },
      AHORA,
    );
    expect(s).toBeGreaterThan(UMBRAL_SALUD);
    expect(s).toBeCloseTo(0.636, 2);
  });

  it('descarta lo poco adoptado aunque sea reciente', () => {
    // fast-mersenne-twister: 20.732 dl/semana, 2 dependientes, 2021.
    const s = scoreSalud(
      { descargas: 20732, dependientes: 2, publicado: '2021-01-18T07:57:42.988Z' },
      AHORA,
    );
    expect(s).toBeLessThan(UMBRAL_SALUD);
    expect(s).toBeCloseTo(0.364, 2);
  });

  it('siempre devuelve un número entre 0 y 1', () => {
    const extremos = [
      { descargas: 0, dependientes: 0, publicado: '1999-01-01T00:00:00.000Z' },
      { descargas: 999_999_999, dependientes: 999_999, publicado: AHORA.toISOString() },
    ];
    for (const e of extremos) {
      const s = scoreSalud(e, AHORA);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('una fecha ilegible no rompe el cálculo (frescura 0, no NaN)', () => {
    const s = scoreSalud({ descargas: 1000, dependientes: 10, publicado: 'no-es-fecha' }, AHORA);
    expect(Number.isFinite(s)).toBe(true);
  });
});

describe('descalificar — filtros duros', () => {
  const base = {
    nombre: 'candidato',
    descargas: 50000,
    dependientes: 20,
    publicado: '2026-01-01T00:00:00.000Z',
    keywords: ['random', 'rng'],
    inseguro: false,
    deprecado: false,
  };
  const kwMuerto = ['rng', 'random', 'mersennetwister'];

  it('deja pasar un candidato sano y relevante', () => {
    expect(descalificar(base, 'mersennetwister', kwMuerto)).toBeNull();
  });

  it('descarta paquetes de tipos: no son un reemplazo', () => {
    expect(descalificar({ ...base, nombre: '@types/mersenne-twister' }, 'mersennetwister', kwMuerto))
      .toMatch(/tipos/i);
  });

  it('descarta el propio paquete muerto', () => {
    expect(descalificar({ ...base, nombre: 'mersennetwister' }, 'mersennetwister', kwMuerto))
      .toMatch(/mismo paquete/i);
  });

  it('descarta candidatos deprecados o marcados inseguros', () => {
    expect(descalificar({ ...base, deprecado: true }, 'mersennetwister', kwMuerto)).toMatch(/deprecad/i);
    expect(descalificar({ ...base, inseguro: true }, 'mersennetwister', kwMuerto)).toMatch(/insegur/i);
  });

  it('descarta lo que nadie usa (pocos dependientes Y pocas descargas)', () => {
    expect(descalificar({ ...base, descargas: 500, dependientes: 2 }, 'mersennetwister', kwMuerto))
      .toMatch(/adopción/i);
    // Con descargas altas ya no se descarta aunque tenga pocos dependientes.
    expect(descalificar({ ...base, descargas: 50000, dependientes: 2 }, 'mersennetwister', kwMuerto))
      .toBeNull();
  });

  it('EL FILTRO QUE SALVA EL RESULTADO: descarta lo irrelevante por solape de keywords', () => {
    // Sin este filtro, el ranking por salud recomendaba crypto-random-string y
    // postgres-range para reemplazar un generador de Mersenne Twister.
    expect(descalificar({ ...base, keywords: ['random', 'string', 'crypto'] }, 'mersennetwister', kwMuerto))
      .toMatch(/dominio|keywords/i);
    expect(descalificar({ ...base, keywords: [] }, 'mersennetwister', kwMuerto)).toMatch(/dominio|keywords/i);
    // Dos keywords en común sí pasa.
    expect(descalificar({ ...base, keywords: ['random', 'rng', 'otra'] }, 'mersennetwister', kwMuerto))
      .toBeNull();
  });

  it('EL BUG DEL E2E: solapar solo en genéricas NO cuenta como relevancia', () => {
    // request(["http","simple","util","utility"]) vs unist-util-visit(["unist","util","utility"]):
    // solapan en util+utility, que no dicen nada. Antes pasaban; ahora no.
    const kwRequest = ['http', 'simple', 'util', 'utility'];
    expect(descalificar({ ...base, nombre: 'unist-util-visit', keywords: ['unist', 'util', 'utility'] }, 'request', kwRequest))
      .toMatch(/dominio|keywords/i);
    // Pero un paquete que sí comparte la keyword específica pasa.
    expect(descalificar({ ...base, nombre: 'got', keywords: ['http', 'util'] }, 'request', kwRequest))
      .toBeNull();
  });

  it('el mínimo de solape se adapta a cuántas keywords específicas hay', () => {
    // Con una sola keyword específica no se puede exigir 2: se exige 1.
    expect(descalificar({ ...base, nombre: 'got', keywords: ['http'] }, 'request', ['http', 'util']))
      .toBeNull();
    // Con tres específicas se siguen exigiendo 2.
    expect(descalificar({ ...base, keywords: ['random'] }, 'mersennetwister', kwMuerto))
      .toMatch(/dominio|keywords/i);
  });

  it('si el paquete muerto no tiene ninguna keyword específica, nadie es relevante', () => {
    // Sin dominio identificable, cualquier recomendación sería adivinanza.
    expect(descalificar({ ...base, keywords: ['util'] }, 'x', ['util', 'library']))
      .toMatch(/dominio|keywords/i);
  });
});

describe('rankearCandidatos — CASO REAL mersennetwister, contra la respuesta capturada', () => {
  const kwMuerto = ['rng', 'random', 'mersennetwister'];
  const ranking = rankearCandidatos(busqueda, 'mersennetwister', kwMuerto, AHORA);

  it('propone mersenne-twister, que es el reemplazo correcto del mismo algoritmo', () => {
    expect(ranking.map((c) => c.nombre)).toContain('mersenne-twister');
  });

  it('ANTIRREGRESIVO: no cuela candidatos absurdos', () => {
    const nombres = ranking.map((c) => c.nombre);
    // Todos estos venían arriba en el ranking por salud antes del filtro de relevancia.
    expect(nombres).not.toContain('crypto-random-string');
    expect(nombres).not.toContain('postgres-range');
    expect(nombres).not.toContain('@csstools/postcss-random-function');
    expect(nombres).not.toContain('ecpair');
    expect(nombres.some((n) => n.startsWith('@types/'))).toBe(false);
  });

  it('devuelve como mucho 3 candidatos, ordenados por salud descendente', () => {
    expect(ranking.length).toBeLessThanOrEqual(3);
    const scores = ranking.map((c) => c.score_salud);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('todos los propuestos superan el umbral', () => {
    expect(ranking.every((c) => c.score_salud >= UMBRAL_SALUD)).toBe(true);
  });

  it('cada candidato trae los números que justifican recomendarlo', () => {
    const c = ranking.find((x) => x.nombre === 'mersenne-twister')!;
    expect(c.descargas_semanales).toBe(880958);
    expect(c.dependientes).toBe(191);
    expect(c.ultima_publicacion.startsWith('2016-08-01')).toBe(true);
  });

  it('sin candidatos que pasen el corte devuelve lista vacía (no fuerza una mala)', () => {
    // Keywords que no solapan con nada de la respuesta capturada.
    expect(rankearCandidatos(busqueda, 'mersennetwister', ['contabilidad', 'facturas'], AHORA))
      .toEqual([]);
  });

  it('una respuesta de búsqueda vacía o rota no lanza', () => {
    expect(rankearCandidatos({ objects: [] }, 'x', ['a', 'b'], AHORA)).toEqual([]);
    expect(rankearCandidatos(null, 'x', ['a', 'b'], AHORA)).toEqual([]);
    expect(rankearCandidatos({}, 'x', ['a', 'b'], AHORA)).toEqual([]);
  });
});
