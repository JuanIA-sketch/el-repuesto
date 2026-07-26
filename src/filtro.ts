/**
 * Lectura y validación del reporte de El Filtro (su contrato `schemaVersion: 1`).
 *
 * El Repuesto NO vuelve a escanear nada: todo lo que sabe del estado de tus repos sale
 * de aquí. Por eso este módulo es estricto con la forma y permisivo con el contenido:
 * un reporte con estructura rota se rechaza con un mensaje claro, pero un reporte
 * legítimamente vacío o con repos sin auditar es normal y se procesa igual.
 */

/** Espejo del `FixTarget` de El Filtro. */
export interface FiltroFix {
  package: string;
  version: string;
  isSemVerMajor: boolean;
}

export interface FiltroAdvisory {
  titles: string[];
  urls: string[];
  range: string;
}

/**
 * Espejo del `Finding` de El Filtro. `fix` es opcional a propósito: su AUSENCIA significa
 * "reporte de una versión anterior de El Filtro" y su presencia en `null` significa
 * "npm no nombró versión objetivo". Son dos cosas distintas y el tipo lo refleja.
 */
export interface FiltroFinding {
  type: 'vulnerability' | 'deprecated';
  package: string;
  installedVersions: string[];
  severity: string | null;
  bucket: 'fix-now' | 'can-wait';
  direct: boolean;
  fixAvailable: boolean;
  fix?: FiltroFix | null;
  explanation: string;
  advisory: FiltroAdvisory | null;
  unresolvedAdvisories?: number;
}

export interface FiltroRepo {
  name: string;
  path: string;
  ecosystem: 'npm' | 'pip' | 'none';
  status: 'audited' | 'no-audit' | 'not-applicable' | 'pending';
  statusReason: string | null;
  findings: FiltroFinding[];
}

export interface FiltroReport {
  schemaVersion: number;
  tool: string;
  generatedAt: string;
  root: string;
  repos: FiltroRepo[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Valida que el JSON sea un reporte de El Filtro. Lanza con un mensaje accionable —
 * el error más probable es que alguien pase el archivo equivocado.
 */
export function parseFiltroReport(json: unknown): FiltroReport {
  const root = asRecord(json);
  if (!root) {
    throw new Error('El archivo no contiene un objeto JSON. ¿Es el reporte de El Filtro?');
  }
  if (root.tool !== 'el-filtro') {
    throw new Error(
      `Esto no parece un reporte de El Filtro (tool: ${JSON.stringify(root.tool) ?? 'ausente'}). ` +
        'Genera uno con: el-filtro --path <carpeta>',
    );
  }
  if (!Array.isArray(root.repos)) {
    throw new Error('El reporte de El Filtro no trae la lista de repos (campo `repos`).');
  }
  return root as unknown as FiltroReport;
}

/**
 * Hallazgos sobre los que El Repuesto puede recetar algo: solo npm (v1) y solo de repos
 * que de verdad se auditaron. Un repo `no-audit` no tiene hallazgos que valgan, pero su
 * existencia sí se reporta en el resumen — ver `contarReposSinAuditar`.
 */
export function hallazgosAccionables(
  report: FiltroReport,
): Array<{ repo: FiltroRepo; finding: FiltroFinding }> {
  const out: Array<{ repo: FiltroRepo; finding: FiltroFinding }> = [];
  for (const repo of report.repos) {
    if (repo.ecosystem !== 'npm' || repo.status !== 'audited') continue;
    for (const finding of repo.findings ?? []) out.push({ repo, finding });
  }
  return out;
}

/**
 * Repos que El Filtro no pudo auditar. No es cosmético: si varios repos fallaron, las
 * recomendaciones cubren menos de lo que parece y hay que decirlo en voz alta.
 */
export function contarReposSinAuditar(report: FiltroReport): number {
  return report.repos.filter((r) => r.status === 'no-audit').length;
}
