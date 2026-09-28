export const DEFAULT_E2E_DATABASE_URL = 'postgresql://botsaas:botsaas@localhost:5432/botsaas_e2e';

/** Validação pura: não conecta nem inclui a URL/credenciais em erros. */
export function resolveE2eDatabaseTarget(rawUrl: string) {
  let url: URL;
  try {
    if (/\s/u.test(rawUrl) || rawUrl.includes('\0')) throw new Error();
    url = new URL(rawUrl);
  } catch {
    throw new Error('E2E_DATABASE_URL inválida. Informe uma URL PostgreSQL de teste.');
  }

  // Query strings do pg podem sobrescrever host/database. O destino destrutivo
  // deve ser totalmente definido pela autoridade e pelo pathname validados.
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !url.hostname ||
    url.search ||
    url.hash ||
    url.port === '0'
  ) {
    throw new Error(
      'E2E_DATABASE_URL exige PostgreSQL, host e porta válidos, sem query ou fragmento.',
    );
  }
  const database = url.pathname.slice(1);
  // Segmentos ASCII, e2e como segmento próprio e limite do identificador PostgreSQL.
  // Aceita botsaas_e2e, botsaas_e2e_resume e botsaas_ci_e2e, entre outros nomes exclusivos.
  if (!/^botsaas_(?:[a-z0-9]+_)*e2e(?:_[a-z0-9]+)*$/.test(database) || database.length > 63) {
    throw new Error('Banco E2E deve usar botsaas_(segmentos_)e2e(_segmentos), até 63 caracteres.');
  }

  const admin = new URL(url);
  admin.pathname = '/postgres';
  return { database, connectionString: url.toString(), adminConnectionString: admin.toString() };
}
