import path from 'node:path';

/** Credenciais exclusivas do seed descartável E2E; compartilhadas com os testes. */
export const PASSWORD = 'demo-senha-123';
export const OWNER = 'dono@clinicademo.local';
export const PLATFORM_ADMIN = 'admin@plataforma.local';


/** Diretório onde a API do E2E grava os e-mails (EMAIL_PROVIDER=log). */
export const E2E_MAIL_DIR = path.resolve(import.meta.dirname, '../../../.local/e2e-mail');
