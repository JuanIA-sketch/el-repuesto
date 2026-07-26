import { describe, it, expect } from 'vitest';
import { extraerReemplazo } from '../src/reemplazo/mensaje.js';

/**
 * El Filtro ya responde "¿este mensaje menciona un reemplazo?" (booleano). Aquí hace falta
 * el NOMBRE. Se conserva su sesgo deliberado: ante texto libre que no se reconoce con
 * certeza, se responde null. Inventar un nombre es peor que no dar ninguno.
 */
describe('extraerReemplazo — casos reales de mensajes de deprecación', () => {
  it('extrae el nombre de "Use X module instead" (caso real de node-uuid)', () => {
    expect(extraerReemplazo('Use uuid module instead')).toBe('uuid');
  });

  it('extrae de las demás formas explícitas', () => {
    expect(extraerReemplazo('This package is replaced by got')).toBe('got');
    expect(extraerReemplazo('superseded by @scope/nuevo')).toBe('@scope/nuevo');
    expect(extraerReemplazo('Deprecated in favor of fast-xml-parser')).toBe('fast-xml-parser');
    expect(extraerReemplazo('Please migrate to date-fns')).toBe('date-fns');
    expect(extraerReemplazo('switch to node-fetch')).toBe('node-fetch');
    expect(extraerReemplazo('we recommend using babel-preset-env')).toBe('babel-preset-env');
  });

  it('CASO REAL mersennetwister: mensaje sin reemplazo → null (cae a búsqueda)', () => {
    // Capturado del registro: registry.npmjs.org/mersennetwister, todas sus versiones.
    expect(
      extraerReemplazo(
        'Package no longer supported. Contact Support at https://www.npmjs.com/support for more info.',
      ),
    ).toBeNull();
  });

  it('CASO REAL request: aviso con URL pero sin nombre de reemplazo → null', () => {
    expect(
      extraerReemplazo('request has been deprecated, see https://github.com/request/request/issues/3142'),
    ).toBeNull();
  });

  it('respeta los contextos negativos: "no uses esto" no es una recomendación', () => {
    expect(extraerReemplazo('Do not use this package')).toBeNull();
    expect(extraerReemplazo('use at your own risk')).toBeNull();
    expect(extraerReemplazo('This package is no longer in use')).toBeNull();
  });

  it('no confunde una URL con un nombre de paquete', () => {
    expect(extraerReemplazo('migrate to https://example.com/docs')).toBeNull();
    expect(extraerReemplazo('see https://github.com/x/y instead')).toBeNull();
  });

  it('no devuelve palabras sueltas del idioma como si fueran paquetes', () => {
    // "use it instead" encaja con el patrón pero "it" no es un paquete.
    expect(extraerReemplazo('use it instead')).toBeNull();
    expect(extraerReemplazo('use the instead')).toBeNull();
    expect(extraerReemplazo('migrate to the new version')).toBeNull();
  });

  it('limpia puntuación pegada al nombre', () => {
    expect(extraerReemplazo('This package is replaced by got.')).toBe('got');
    expect(extraerReemplazo('Use uuid, module instead')).toBe('uuid');
    expect(extraerReemplazo('in favor of `nanoid`')).toBe('nanoid');
  });

  it('tolera entradas vacías o no-texto sin lanzar', () => {
    expect(extraerReemplazo('')).toBeNull();
    expect(extraerReemplazo('   ')).toBeNull();
    expect(extraerReemplazo(undefined as unknown as string)).toBeNull();
    expect(extraerReemplazo(null as unknown as string)).toBeNull();
  });

  it('no se autorecomienda: si el mensaje nombra al propio paquete, no sirve', () => {
    expect(extraerReemplazo('use request instead', 'request')).toBeNull();
  });
});
