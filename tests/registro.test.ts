import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { existeYEstaSano } from '../src/reemplazo/registro.js';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

// Packuments REALES capturados del registro.
const packMersennetwister = fixture('packument-mersennetwister.json');
const packMersenneTwister = fixture('packument-mersenne-twister.json');

describe('existeYEstaSano — valida el nombre antes de recomendarlo', () => {
  it('acepta un paquete real y no deprecado', async () => {
    const consultar = async () => packMersenneTwister;
    expect(await existeYEstaSano('mersenne-twister', consultar)).toBe(true);
  });

  it('RECHAZA un paquete cuya última versión está deprecada', async () => {
    // mersennetwister real: TODAS sus versiones están deprecadas. Que un mensaje lo
    // nombrara como reemplazo no lo convertiría en uno.
    const consultar = async () => packMersennetwister;
    expect(await existeYEstaSano('mersennetwister', consultar)).toBe(false);
  });

  it('rechaza un paquete que no existe (el registro devuelve null)', async () => {
    expect(await existeYEstaSano('paquete-que-no-existe-xyz', async () => null)).toBe(false);
  });

  it('rechaza respuestas rotas sin lanzar', async () => {
    expect(await existeYEstaSano('x', async () => ({}))).toBe(false);
    expect(await existeYEstaSano('x', async () => ({ 'dist-tags': {} }))).toBe(false);
    expect(await existeYEstaSano('x', async () => 'texto')).toBe(false);
  });
});
