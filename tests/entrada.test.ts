import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolverEntrada, urlDeArchivo } from '../src/facilidad/entrada.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

describe('resolverEntrada — de dónde leer la API del candidato', () => {
  it('PREFIERE el .d.ts cuando el paquete lo publica: es la superficie más limpia', () => {
    const pack = {
      'dist-tags': { latest: '3.0.0' },
      versions: { '3.0.0': { main: 'dist/index.cjs', types: 'dist/index.d.ts' } },
    };
    expect(resolverEntrada(pack)).toEqual({ version: '3.0.0', archivo: 'dist/index.d.ts' });
  });

  it('acepta `typings` como alias de `types`', () => {
    const pack = {
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { main: 'i.js', typings: 'i.d.ts' } },
    };
    expect(resolverEntrada(pack)?.archivo).toBe('i.d.ts');
  });

  it('CASO REAL mersenne-twister: sin tipos, cae al `main` de JS plano', () => {
    // Ni el paquete muerto ni el ganador publican .d.ts. Si esto solo mirara `types`,
    // el caso real de validación se quedaría sin superficie.
    const pack = fixture('packument-mersenne-twister.json');
    expect(resolverEntrada(pack)).toEqual({
      version: '1.1.0',
      archivo: 'src/mersenne-twister.js',
    });
  });

  it('sin `main` ni tipos cae a index.js, que es el default de npm', () => {
    const pack = { 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': {} } };
    expect(resolverEntrada(pack)?.archivo).toBe('index.js');
  });

  it('devuelve null si el packument no sirve', () => {
    expect(resolverEntrada(null)).toBeNull();
    expect(resolverEntrada({})).toBeNull();
    expect(resolverEntrada({ 'dist-tags': {} })).toBeNull();
  });
});

describe('urlDeArchivo — dónde pedir ese archivo', () => {
  it('arma la url del CDN con versión exacta', () => {
    expect(urlDeArchivo('mersenne-twister', '1.1.0', 'src/mersenne-twister.js'))
      .toBe('https://unpkg.com/mersenne-twister@1.1.0/src/mersenne-twister.js');
  });

  it('normaliza rutas que vienen con ./ delante', () => {
    expect(urlDeArchivo('x', '1.0.0', './dist/i.js')).toBe('https://unpkg.com/x@1.0.0/dist/i.js');
  });

  it('codifica nombres con scope sin romper la barra del scope', () => {
    expect(urlDeArchivo('@scope/pkg', '2.0.0', 'i.js'))
      .toBe('https://unpkg.com/@scope/pkg@2.0.0/i.js');
  });
});
