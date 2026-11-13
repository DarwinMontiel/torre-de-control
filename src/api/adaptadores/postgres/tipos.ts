/**
 * Lo mínimo que la torre necesita de un pool de PostgreSQL. Lo cumplen `pg.Pool` y el
 * adaptador de pg-mem que usan las pruebas.
 */
export interface ResultadoPg<T> {
  rows: T[];
  rowCount: number | null;
}

export interface ClientePg {
  query<T = Record<string, unknown>>(texto: string, valores?: unknown[]): Promise<ResultadoPg<T>>;
  release(): void;
}

export interface ConexionPg {
  query<T = Record<string, unknown>>(texto: string, valores?: unknown[]): Promise<ResultadoPg<T>>;
  connect(): Promise<ClientePg>;
}
