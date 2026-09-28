/**
 * Bootstrap explícito: DATABASE_URL e BOOTSTRAP_OWNER_EMAIL/NAME/PASSWORD.
 * Sem PASSWORD no ambiente, lê uma linha de stdin somente quando não for terminal.
 * Não aceita argumentos, não carrega .env e não inicializa providers externos.
 */
import { disconnectSystemDb } from '@botsaas/database';
import { BootstrapOwnerError, bootstrapPlatformOwner } from './modules/platform/bootstrap-owner';

async function readPassword(): Promise<string> {
  const configured = process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (configured !== undefined) return configured;
  if (process.stdin.isTTY) {
    throw new BootstrapOwnerError(
      'Informe BOOTSTRAP_OWNER_PASSWORD ou forneça a senha por stdin sem terminal.',
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk as Buffer);
    size += bytes.length;
    if (size > 1024) throw new BootstrapOwnerError('Entrada de senha excedeu o limite permitido.');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks)
    .toString('utf8')
    .replace(/\r?\n$/, '');
}

async function main() {
  try {
    if (process.argv.length > 2) {
      throw new BootstrapOwnerError(
        'Não use argumentos. Configure BOOTSTRAP_OWNER_EMAIL/NAME/PASSWORD.',
      );
    }
    if (!process.env.DATABASE_URL?.trim()) {
      throw new BootstrapOwnerError('DATABASE_URL explícita é obrigatória.');
    }
    const email = process.env.BOOTSTRAP_OWNER_EMAIL;
    const name = process.env.BOOTSTRAP_OWNER_NAME;
    if (!email?.trim() || !name?.trim()) {
      throw new BootstrapOwnerError(
        'BOOTSTRAP_OWNER_EMAIL e BOOTSTRAP_OWNER_NAME são obrigatórios.',
      );
    }
    const password = await readPassword();
    delete process.env.BOOTSTRAP_OWNER_PASSWORD;
    const owner = await bootstrapPlatformOwner({ email, name, password });
    process.stdout.write(`Proprietário da plataforma criado: ${owner.id}\n`);
  } catch (error) {
    // Erros inesperados do driver podem conter credenciais/SQL; nunca imprimir o erro bruto.
    const message =
      error instanceof BootstrapOwnerError
        ? error.message
        : 'Falha no bootstrap. Verifique a conexão, as migrações e o estado do banco.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    delete process.env.BOOTSTRAP_OWNER_PASSWORD;
    await disconnectSystemDb().catch(() => {
      process.exitCode = 1;
    });
  }
}

void main();
