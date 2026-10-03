import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import { E2E_MAIL_DIR, PASSWORD } from './fixtures';

export { PASSWORD, OWNER, PLATFORM_ADMIN } from './fixtures';

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/(app|platform)/);
}

/** Último link enviado por e-mail para o endereço (a API grava cada e-mail como .html). */
export async function lastEmailLink(to: string, pathname: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const files = (await readdir(E2E_MAIL_DIR).catch(() => [] as string[])).sort().reverse();
    for (const file of files) {
      const html = await readFile(path.join(E2E_MAIL_DIR, file), 'utf8');
      if (!html.startsWith(`<!-- Para: ${to} `)) continue;
      const match = html.match(new RegExp(`https?://[^"<\\s]+${pathname}\\?token=[A-Za-z0-9_%-]+`));
      if (match) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Nenhum e-mail com ${pathname} para ${to}`);
}

export async function signup(page: Page, email: string, password: string) {
  await page.goto('/cadastro?plano=starter&periodo=anual');
  await page.getByLabel('Seu nome').fill('Rafa E2E');
  await page.getByLabel('E-mail de trabalho').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByLabel('Nome da empresa').fill('Ateliê E2E');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail' })).toBeVisible();
}
