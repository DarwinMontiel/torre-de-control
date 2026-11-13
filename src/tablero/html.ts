/**
 * Plantillas HTML seguras sin framework.
 *
 * `html\`<b>${nombre}</b>\`` escapa todo lo interpolado salvo otros fragmentos `Html`.
 * Los nombres de bots, mensajes de eventos y detalles de alertas vienen de afuera (de
 * los bots, vía la API): nunca se insertan sin escapar.
 */
export class Html {
  readonly valor: string;

  constructor(valor: string) {
    this.valor = valor;
  }

  toString(): string {
    return this.valor;
  }
}

const ENTIDADES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapar(valor: unknown): string {
  return String(valor).replace(/[&<>"']/g, (c) => ENTIDADES[c] ?? c);
}

function convertir(valor: unknown): string {
  if (valor instanceof Html) return valor.valor;
  if (Array.isArray(valor)) return valor.map(convertir).join('');
  if (valor === null || valor === undefined || valor === false) return '';
  return escapar(valor);
}

export function html(partes: TemplateStringsArray, ...valores: unknown[]): Html {
  let r = partes[0] ?? '';
  valores.forEach((v, i) => {
    r += convertir(v) + (partes[i + 1] ?? '');
  });
  return new Html(r);
}

/** Inserta HTML ya confiable (p. ej. un SVG generado aquí mismo). */
export function crudo(valor: string): Html {
  return new Html(valor);
}
