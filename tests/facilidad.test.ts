import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { contarArchivosQueUsan, facilidadPorUso } from '../src/facilidad/uso.js';
import { superficieUsada, superficieOfrecida, compatibilidadApi, facilidadPorApi } from '../src/facilidad/api.js';
import { combinarFacilidad } from '../src/facilidad/combinar.js';

const temporales: string[] = [];
function repoTemporal(archivos: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'el-repuesto-test-'));
  temporales.push(dir);
  for (const [rel, contenido] of Object.entries(archivos)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contenido);
  }
  return dir;
}
afterAll(() => {
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
});

describe('contarArchivosQueUsan — señal (a) del brief §5.3', () => {
  it('cuenta los archivos que importan el paquete', () => {
    const repo = repoTemporal({
      'src/a.js': "import MT from 'mersennetwister';\n",
      'src/b.js': "const MT = require('mersennetwister');\n",
      'src/c.js': "import algo from 'otra-cosa';\n",
    });
    expect(contarArchivosQueUsan(repo, 'mersennetwister')).toBe(2);
  });

  it('NO cuenta menciones que no son imports', () => {
    const repo = repoTemporal({
      'src/a.js': "// TODO: cambiar mersennetwister por otra cosa\nconst x = 1;\n",
      'README.md': 'Usamos mersennetwister para el ruido.\n',
    });
    expect(contarArchivosQueUsan(repo, 'mersennetwister')).toBe(0);
  });

  it('no entra a node_modules, .git ni dist (misma convención que El Filtro)', () => {
    const repo = repoTemporal({
      'src/a.js': "import MT from 'mersennetwister';\n",
      'node_modules/x/index.js': "import MT from 'mersennetwister';\n",
      'dist/bundle.js': "import MT from 'mersennetwister';\n",
    });
    expect(contarArchivosQueUsan(repo, 'mersennetwister')).toBe(1);
  });

  it('distingue el paquete de otro con el mismo prefijo', () => {
    const repo = repoTemporal({
      'src/a.js': "import x from 'mersennetwister-extra';\n",
      'src/b.js': "import y from 'mersennetwister';\n",
    });
    expect(contarArchivosQueUsan(repo, 'mersennetwister')).toBe(1);
  });

  it('cuenta subrutas del paquete como uso', () => {
    const repo = repoTemporal({ 'src/a.js': "import x from 'lodash/merge';\n" });
    expect(contarArchivosQueUsan(repo, 'lodash')).toBe(1);
  });

  it('una ruta que no existe devuelve 0 sin lanzar', () => {
    expect(contarArchivosQueUsan('/ruta/que/no/existe', 'x')).toBe(0);
  });
});

describe('facilidadPorUso — umbrales del brief §5.3', () => {
  it('1 a 3 archivos → 🟢, 4 a 10 → 🟡, 11+ → 🔴', () => {
    expect(facilidadPorUso(1)).toBe('🟢');
    expect(facilidadPorUso(3)).toBe('🟢');
    expect(facilidadPorUso(4)).toBe('🟡');
    expect(facilidadPorUso(10)).toBe('🟡');
    expect(facilidadPorUso(11)).toBe('🔴');
    expect(facilidadPorUso(50)).toBe('🔴');
  });

  it('0 archivos es 🟢: no lo usas en código, cambiarlo es trivial', () => {
    expect(facilidadPorUso(0)).toBe('🟢');
  });
});

describe('superficieUsada — qué le pides tú al paquete', () => {
  it('CASO REAL: default import usado como constructor + un método', () => {
    // Copiado de batallas-imperio-agentico/src/Game/Utils/Math.class.js
    const codigo = `
import MersenneTwister from 'mersennetwister';
import * as THREE from 'three';
const MT_ = new MersenneTwister(7);
function random() { return MT_.random(); }
`;
    expect(superficieUsada(codigo, 'mersennetwister').sort()).toEqual(['random']);
  });

  it('cuenta los named imports directamente', () => {
    const codigo = "import { debounce, throttle } from 'lodash';\ndebounce(fn, 100);";
    expect(superficieUsada(codigo, 'lodash').sort()).toEqual(['debounce', 'throttle']);
  });

  it('sigue los accesos sobre un namespace import', () => {
    const codigo = "import * as _ from 'lodash';\n_.merge(a,b);\n_.cloneDeep(c);";
    expect(superficieUsada(codigo, 'lodash').sort()).toEqual(['cloneDeep', 'merge']);
  });

  it('sigue accesos sobre el binding default', () => {
    const codigo = "import _ from 'lodash';\n_.merge(a,b);";
    expect(superficieUsada(codigo, 'lodash')).toContain('merge');
  });

  it('funciona con require además de import', () => {
    const codigo = "const MT = require('mersennetwister');\nconst m = new MT(1);\nm.random();";
    expect(superficieUsada(codigo, 'mersennetwister')).toContain('random');
  });

  it('LÍMITE DECLARADO: un salto de alias, no dos', () => {
    // m.random() se detecta (1 salto). El segundo salto queda fuera a propósito:
    // seguirlo sin un parser de verdad produce más falsos que aciertos.
    const codigo = `
import MT from 'pkg';
const a = new MT(1);
const b = a;
a.siSeDetecta();
b.noSeDetecta();
`;
    const usada = superficieUsada(codigo, 'pkg');
    expect(usada).toContain('siSeDetecta');
    expect(usada).not.toContain('noSeDetecta');
  });

  it('no cuenta miembros anidados: a.b.c aporta solo b', () => {
    const codigo = "import p from 'pkg';\np.uno.dos.tres();";
    const usada = superficieUsada(codigo, 'pkg');
    expect(usada).toContain('uno');
    expect(usada).not.toContain('dos');
    expect(usada).not.toContain('tres');
  });

  it('un archivo que no importa el paquete no aporta superficie', () => {
    expect(superficieUsada("import x from 'otro';\nx.algo();", 'pkg')).toEqual([]);
  });
});

describe('superficieOfrecida — qué expone el candidato', () => {
  it('CASO REAL mersenne-twister: lee prototype de JS plano (no publica .d.ts)', () => {
    // Ni el paquete muerto ni el ganador publican tipos: si esto solo leyera .d.ts,
    // el caso real de validación no funcionaría.
    const js = `
var MersenneTwister = function(seed) { this.init_seed(seed); };
MersenneTwister.prototype.init_seed = function(s) {};
MersenneTwister.prototype.random = function() { return 0.5; };
MersenneTwister.prototype.random_int = function() { return 1; };
module.exports = MersenneTwister;
`;
    const ofrecida = superficieOfrecida(js, 'mersenne-twister.js');
    expect(ofrecida).toContain('random');
    expect(ofrecida).toContain('init_seed');
    expect(ofrecida).toContain('random_int');
  });

  it('lee exports de ESM', () => {
    const js = 'export function uno() {}\nexport const dos = 1;\nexport class Tres {}';
    const o = superficieOfrecida(js, 'index.js');
    expect(o).toEqual(expect.arrayContaining(['uno', 'dos', 'Tres']));
  });

  it('lee exports nombrados en bloque', () => {
    expect(superficieOfrecida('const a=1,b=2;\nexport { a, b };', 'i.js'))
      .toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('CASO REAL d3-random: en un re-export el nombre público es el de DESPUÉS de `as`', () => {
    // Ojo con la dirección: en un IMPORT `{b as c}` la API del paquete es `b`, pero en un
    // EXPORT `{default as randomUniform}` la API es `randomUniform`. Tomar el primero aquí
    // devolvía "default" y dejaba la superficie vacía.
    const js = `
export {default as randomUniform} from "./uniform.js";
export {default as randomInt} from "./int.js";
export {default as randomNormal} from "./normal.js";
`;
    const o = superficieOfrecida(js, 'index.js');
    expect(o).toEqual(expect.arrayContaining(['randomUniform', 'randomInt', 'randomNormal']));
    expect(o).not.toContain('default');
  });

  it('un re-export con estrella no aporta nombres inventados', () => {
    expect(superficieOfrecida('export * from "./otro.js";', 'i.js')).toEqual([]);
  });

  it('lee exports estilo CommonJS', () => {
    const js = 'exports.uno = function(){};\nmodule.exports = { dos: 1, tres: 2 };';
    expect(superficieOfrecida(js, 'i.js')).toEqual(expect.arrayContaining(['uno', 'dos', 'tres']));
  });

  it('prefiere declaraciones cuando el archivo es .d.ts', () => {
    const dts = 'export declare function alfa(): void;\nexport declare const beta: number;';
    expect(superficieOfrecida(dts, 'index.d.ts')).toEqual(expect.arrayContaining(['alfa', 'beta']));
  });

  it('un archivo vacío o ilegible da superficie vacía', () => {
    expect(superficieOfrecida('', 'i.js')).toEqual([]);
    expect(superficieOfrecida(null as unknown as string, 'i.js')).toEqual([]);
  });
});

describe('compatibilidadApi — señal (b) del brief §5.3', () => {
  it('CASO REAL: mersennetwister → mersenne-twister es 100%', () => {
    expect(compatibilidadApi(['random'], ['init_seed', 'random', 'random_int'])).toBe(1);
  });

  it('calcula la fracción de lo que usas que sí existe en el candidato', () => {
    expect(compatibilidadApi(['a', 'b', 'c', 'd'], ['a', 'b', 'z'])).toBe(0.5);
  });

  it('devuelve null cuando no se pudo leer alguna de las dos superficies', () => {
    // Sin dato NO se asume compatible. Es la diferencia entre "no sé" y "sí".
    expect(compatibilidadApi([], ['a', 'b'])).toBeNull();
    expect(compatibilidadApi(['a'], [])).toBeNull();
  });
});

describe('facilidadPorApi — umbrales del brief §5.3', () => {
  it('70%+ → 🟢, 40-69% → 🟡, <40% → 🔴', () => {
    expect(facilidadPorApi(1)).toBe('🟢');
    expect(facilidadPorApi(0.7)).toBe('🟢');
    expect(facilidadPorApi(0.69)).toBe('🟡');
    expect(facilidadPorApi(0.4)).toBe('🟡');
    expect(facilidadPorApi(0.39)).toBe('🔴');
    expect(facilidadPorApi(0)).toBe('🔴');
  });

  it('sin dato → 🟡, NUNCA 🟢', () => {
    // Falta de información no puede disfrazarse de buena noticia.
    expect(facilidadPorApi(null)).toBe('🟡');
  });
});

describe('combinarFacilidad — peor caso de las dos (brief §5.3)', () => {
  it('si cualquiera de las dos sale difícil, el resultado es difícil', () => {
    expect(combinarFacilidad('🟢', '🔴')).toBe('🔴');
    expect(combinarFacilidad('🔴', '🟢')).toBe('🔴');
    expect(combinarFacilidad('🟢', '🟡')).toBe('🟡');
    expect(combinarFacilidad('🟡', '🟢')).toBe('🟡');
  });

  it('solo 🟢 con 🟢 da 🟢', () => {
    expect(combinarFacilidad('🟢', '🟢')).toBe('🟢');
  });
});
