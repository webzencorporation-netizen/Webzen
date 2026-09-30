/**
 * Varredura leve de segredos nos arquivos VERSIONADOS (sem dependência externa).
 *
 *   pnpm check:secrets            # todos os arquivos rastreados (CI)
 *   pnpm check:secrets --staged   # só o que está no stage (hook de pré-commit)
 *
 * Nunca imprime o valor encontrado: só arquivo, linha e o tipo de segredo.
 */
import { execFileSync } from 'node:child_process';

export interface SecretFinding {
  file: string;
  line: number;
  kind: string;
}

const PATTERNS: { kind: string; regex: RegExp }[] = [
  { kind: 'Chave da Anthropic', regex: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { kind: 'Chave da Meta Model API', regex: /\bLLM_\d{6,}_[A-Za-z0-9_-]{16,}/ },
  { kind: 'Token de acesso da Meta/WhatsApp', regex: /\bEAA[A-Za-z0-9]{40,}/ },
  { kind: 'Senha de banco Neon', regex: /\bnpg_[A-Za-z0-9]{10,}/ },
  { kind: 'Chave de acesso AWS', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'Token do GitHub', regex: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { kind: 'Chave da OpenAI', regex: /\bsk-(proj-)?[A-Za-z0-9]{32,}/ },
  { kind: 'Chave privada', regex: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  {
    kind: 'URL de banco com senha',
    regex:
      /postgres(ql)?:\/\/[^:\s/]+:(?!\*\*\*|<|\$\{|senha|password|botsaas@)[^@\s]{8,}@(?!localhost|127\.0\.0\.1)/,
  },
];

/** Arquivos que nunca devem ser versionados, independentemente do conteúdo. */
const FORBIDDEN_FILES = /(^|\/)\.env(\.(?!example$)[\w.-]+)?$/;

export function findSecrets(file: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  if (FORBIDDEN_FILES.test(file)) findings.push({ file, line: 0, kind: 'Arquivo .env versionado' });
  content.split('\n').forEach((text, index) => {
    for (const { kind, regex } of PATTERNS) {
      if (regex.test(text)) findings.push({ file, line: index + 1, kind });
    }
  });
  return findings;
}

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function scan(staged: boolean): SecretFinding[] {
  const files = (
    staged
      ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
      : git(['ls-files', '-z'])
  )
    .split('\0')
    .filter(Boolean)
    .filter((file) => !/(^|\/)pnpm-lock\.yaml$|\.(png|jpe?g|gif|webp|ico|pdf|woff2?)$/i.test(file));
  return files.flatMap((file) => {
    try {
      const content = staged ? git(['show', `:${file}`]) : git(['show', `HEAD:${file}`]);
      return findSecrets(file, content);
    } catch {
      return findSecrets(file, ''); // arquivo novo fora do HEAD: ainda checa o nome
    }
  });
}

if (process.argv[1]?.endsWith('check-secrets.ts')) {
  const findings = scan(process.argv.includes('--staged'));
  if (findings.length === 0) {
    process.stdout.write('Nenhum segredo encontrado.\n');
  } else {
    for (const finding of findings) {
      process.stderr.write(
        `SEGREDO? ${finding.file}${finding.line ? `:${finding.line}` : ''} — ${finding.kind}\n`,
      );
    }
    process.stderr.write(
      '\nRemova o valor do arquivo (use .env, ignorado pelo git) e ROTACIONE a credencial se ela já saiu da máquina.\n',
    );
    process.exit(1);
  }
}
