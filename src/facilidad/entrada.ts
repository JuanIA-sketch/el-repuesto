/**
 * Punto de entrada de un candidato: qué archivo leer para saber qué API expone.
 *
 * Se resuelve desde el packument, nunca adivinando la ruta. Adivinar falla en cuanto un
 * paquete usa `dist/` o publica tipos: `pcg` sirve su API en `dist/index.d.ts` y
 * `d3-random` en `src/index.js` — no hay convención común que valga.
 */

/** CDN público del registro npm. Sirve archivos sueltos de un paquete, sin credenciales. */
const CDN = 'https://unpkg.com';

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

export interface Entrada {
  version: string;
  archivo: string;
}

/**
 * Versión `latest` y archivo de entrada.
 *
 * Se prefiere el `.d.ts` cuando existe: declara la superficie pública sin el ruido de la
 * implementación. Cuando no hay tipos —el caso de mersenne-twister y de la mayoría de las
 * librerías viejas— se lee el `main` de JS plano.
 */
export function resolverEntrada(packument: unknown): Entrada | null {
  const p = asRecord(packument);
  const version = texto(asRecord(p?.['dist-tags'])?.latest);
  if (!version) return null;

  const entry = asRecord(asRecord(p?.versions)?.[version]);
  if (!entry) return null;

  const archivo =
    texto(entry.types) ?? texto(entry.typings) ?? texto(entry.main) ?? 'index.js';

  return { version, archivo };
}

/** URL del archivo en el CDN. El `@` del scope no se codifica: es parte de la ruta. */
export function urlDeArchivo(paquete: string, version: string, archivo: string): string {
  const limpio = archivo.replace(/^\.?\//, '');
  return `${CDN}/${paquete}@${version}/${limpio}`;
}
