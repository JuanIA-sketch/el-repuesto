/**
 * Ruta B, paso 1 del brief (§5.2): si el propio mensaje de deprecación nombra un reemplazo,
 * ese es el dato más confiable que existe — lo escribió quien mantiene el paquete.
 *
 * El Filtro ya responde la pregunta binaria ("¿menciona un reemplazo?") en
 * `src/audit/deprecated.ts`. Aquí hace falta el NOMBRE, así que se reusan sus mismos
 * patrones con grupos de captura y se hereda su sesgo deliberado: ante texto libre que
 * no se reconoce con certeza, `null`. Un nombre inventado es peor que ninguno, porque
 * manda a alguien a instalar algo que nadie recomendó.
 */

/**
 * Contextos NEGATIVOS: el mensaje usa "use/using" para advertir, no para ofrecer salida
 * ("Do not use this package", "use at your own risk"). Copiado de El Filtro para que ambas
 * herramientas coincidan en qué consideran una recomendación.
 */
const CONTEXTO_NEGATIVO =
  /\b(?:do\s+not|don'?t|never|avoid|no\s+longer|not)\s+(?:use|using)\b|\bat\s+your\s+own\s+risk\b|\bin\s+use\b/i;

/** Un token de paquete npm: admite @scope/nombre, guiones y puntos. */
const PKG = String.raw`[\w@][\w@/.-]*`;

/** Comilla, backtick o paréntesis de apertura pegado al nombre: "in favor of `nanoid`". */
const ABRE = String.raw`[\`'"(\[]?`;

/** El nombre capturado, tolerando la puntuación con que suelen envolverlo. */
const CAPTURA = `${ABRE}(${PKG})`;

/**
 * Formas EXPLÍCITAS de nombrar un reemplazo, cada una con el nombre capturado. Igual de
 * estrictas que en El Filtro: exigen un marcador inequívoco además del nombre. No basta
 * con que aparezca el verbo "use" suelto.
 */
const PATRONES: RegExp[] = [
  // `,?` tolera "Use uuid, module instead": la coma no debe romper la detección.
  new RegExp(String.raw`\buse\s+${CAPTURA},?(?:\s+\w+){0,3}\s+instead\b`, 'i'),
  new RegExp(String.raw`\brecommend(?:s|ed)?\s+using\s+${CAPTURA}`, 'i'),
  new RegExp(String.raw`\breplaced\s+by\s+${CAPTURA}`, 'i'),
  new RegExp(String.raw`\bsuperseded\s+by\s+${CAPTURA}`, 'i'),
  new RegExp(String.raw`\bin\s+favou?r\s+of\s+${CAPTURA}`, 'i'),
  new RegExp(String.raw`\bmigrate\s+to\s+${CAPTURA}`, 'i'),
  new RegExp(String.raw`\bswitch\s+to\s+${CAPTURA}`, 'i'),
];

/**
 * Palabras que encajan con la forma de un nombre de paquete pero son gramática inglesa.
 * Sin esta lista, "use it instead" produciría el paquete "it".
 */
const PALABRAS_VACIAS: ReadonlySet<string> = new Set([
  'it', 'this', 'that', 'the', 'a', 'an', 'them', 'these', 'those',
  'our', 'its', 'their', 'new', 'newer', 'latest', 'other', 'another',
  'any', 'some', 'something', 'anything', 'nothing', 'one', 'version',
  'package', 'module', 'library', 'lib', 'alternative', 'alternatives',
]);

/** Reglas del registro npm, en lo que importa para descartar basura evidente. */
const NOMBRE_VALIDO = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;

/** Quita puntuación, comillas y backticks pegados al nombre capturado. */
function limpiar(raw: string): string {
  return raw.replace(/^[`'"(\[]+/, '').replace(/[`'"),.\]:;!?]+$/, '');
}

/**
 * ¿El texto capturado es de verdad un nombre de paquete instalable?
 * Descarta URLs, palabras del idioma y nombres que el registro no aceptaría.
 */
function esNombrePlausible(nombre: string, mensaje: string): boolean {
  if (!nombre) return false;
  // Una URL se parte en el ":" y deja "https" como si fuera un paquete. Se descarta por el
  // nombre y por el contexto: si en el mensaje va seguido de "://", era una dirección.
  if (/^(?:https?|ftp)$/i.test(nombre)) return false;
  if (nombre.includes('://') || mensaje.includes(`${nombre}://`)) return false;
  if (PALABRAS_VACIAS.has(nombre.toLowerCase())) return false;
  if (!NOMBRE_VALIDO.test(nombre)) return false;
  // Un nombre con punto y sin guion suele ser un dominio ("example.com").
  if (/^[\w-]+\.[a-z]{2,}$/i.test(nombre) && !nombre.startsWith('@')) return false;
  return true;
}

/**
 * Nombre del paquete de reemplazo que menciona el mensaje, o null si no hay uno claro.
 *
 * `paqueteActual` evita la autorecomendación: un mensaje que nombra al propio paquete
 * abandonado ("use request instead") no ofrece ninguna salida.
 */
export function extraerReemplazo(mensaje: string, paqueteActual?: string): string | null {
  if (typeof mensaje !== 'string' || mensaje.trim() === '') return null;
  if (CONTEXTO_NEGATIVO.test(mensaje)) return null;

  for (const patron of PATRONES) {
    const m = patron.exec(mensaje);
    if (!m?.[1]) continue;
    const nombre = limpiar(m[1]);
    if (!esNombrePlausible(nombre, mensaje)) continue;
    if (paqueteActual && nombre.toLowerCase() === paqueteActual.toLowerCase()) continue;
    return nombre;
  }
  return null;
}
