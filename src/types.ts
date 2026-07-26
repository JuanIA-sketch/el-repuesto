/** Mismo lenguaje visual que El Filtro. 🟢 fácil · 🟡 medio · 🔴 difícil. */
export type Facilidad = '🟢' | '🟡' | '🔴';

/**
 * Qué tan concreto es el arreglo de versión que podemos recetar. Nace de los TRES estados
 * de `fixAvailable` de npm audit (más un cuarto para reportes viejos), y existe para que
 * dos casos muy distintos no se confundan nunca:
 *
 * - `version_exacta`      npm nombró qué instalar y en qué versión.
 * - `sin_version_exacta`  npm confirma que hay arreglo pero no nombra versión, porque se
 *                         resuelve dentro del rango que ya declaras. Es el caso MÁS FÁCIL
 *                         de todo el reporte, no uno dudoso.
 * - `sin_arreglo`         no hay versión segura publicada. Aquí sí estás varado.
 * - `reporte_antiguo`     el reporte viene de una versión de El Filtro sin el campo `fix`.
 *                         No se adivina: se pide volver a correrlo.
 */
export type Certeza =
  | 'version_exacta'
  | 'sin_version_exacta'
  | 'sin_arreglo'
  | 'reporte_antiguo';

/** Ruta A: el paquete sigue vivo, solo hay que subirlo de versión. */
export interface RecomendacionVersion {
  ruta: 'actualizar_version';
  repo: string;
  paquete: string;
  problema: 'vulnerable';
  version_actual: string | null;
  certeza: Certeza;
  /**
   * QUÉ subir. Puede NO ser `paquete`: en un fallo transitivo npm apunta al padre
   * (esbuild vulnerable → sube vitest). null cuando npm no nombró nada.
   */
  paquete_a_subir: string | null;
  version_recomendada: string | null;
  /** true = salto de versión mayor, puede romper. null cuando no hay versión que evaluar. */
  rompe_compatibilidad: boolean | null;
  /** Rango vulnerable tal cual lo reportó El Filtro. Dato de contexto verificable. */
  rango_vulnerable: string;
  fuente_recomendacion: string;
  /** Qué hacer, en lenguaje simple. Sin jerga de CVE. */
  mensaje: string;
  urls: string[];
}

/** Un candidato a reemplazo, con los números duros que justifican recomendarlo. */
export interface Candidato {
  nombre: string;
  /** 0..1, compuesto de adopción + respaldo + frescura. Ver reemplazo/buscar.ts. */
  score_salud: number;
  descargas_semanales: number;
  dependientes: number;
  ultima_publicacion: string;
  /** Peor caso entre uso en código y compatibilidad de API (brief §5.3). */
  facilidad: Facilidad;
  /** Fracción 0..1 de la API que usas y que existe con el mismo nombre; null si no se pudo leer. */
  compatibilidad_api: number | null;
  archivos_afectados: number | null;
  razon: string;
}

/** Ruta B: el paquete está abandonado, hay que cambiarlo. */
export interface RecomendacionReemplazo {
  ruta: 'reemplazo';
  repo: string;
  paquete: string;
  problema: 'abandonado';
  version_actual: string | null;
  /**
   * De dónde salió la propuesta. `mensaje-deprecacion` es la más confiable: la escribió
   * quien mantiene el paquete. `registro-npm` es búsqueda + ranking por números duros.
   */
  fuente_recomendacion: 'mensaje-deprecacion' | 'registro-npm' | 'ninguna';
  mensaje_deprecacion: string;
  candidatos: Candidato[];
  /** Poblado cuando no hay ningún candidato decente. La honestidad manda (brief §5.2.3). */
  sin_alternativa_clara: boolean;
  mensaje: string;
}

export type Recomendacion = RecomendacionVersion | RecomendacionReemplazo;

export interface ResumenRepuesto {
  hallazgosLeidos: number;
  recomendaciones: number;
  actualizarVersion: number;
  reemplazo: number;
  sinAlternativaClara: number;
  /**
   * Repos que El Filtro no pudo auditar. No es un detalle cosmético: si 5 de 20 repos
   * fallaron, las recomendaciones cubren menos de lo que parece y hay que decirlo.
   */
  reposSinAuditar: number;
}

/** El contrato JSON de salida de El Repuesto. */
export interface ReporteRepuesto {
  schemaVersion: number;
  tool: 'el-repuesto';
  generatedAt: string;
  /** De qué reporte de El Filtro salió esto. */
  origen: { tool: string; generatedAt: string; root: string };
  summary: ResumenRepuesto;
  recomendaciones: Recomendacion[];
}
