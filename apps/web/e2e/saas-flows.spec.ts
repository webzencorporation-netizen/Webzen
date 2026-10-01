import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_MAIL_DIR } from './fixtures';

/** Último link enviado por e-mail para o endereço (a API grava cada e-mail como .html). */
async function lastEmailLink(to: string, pathname: string): Promise<string> {
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

async function signup(page: Page, email: string, password: string) {
  await page.goto('/cadastro?plano=starter&periodo=anual');
  await page.getByLabel('Seu nome').fill('Rafa E2E');
  await page.getByLabel('E-mail de trabalho').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByLabel('Nome da empresa').fill('Ateliê E2E');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail' })).toBeVisible();
}

test.describe('site público e contas', () => {
  test('landing apresenta o WebZen e os preços mensal e anual', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Automatize seu negócio com inteligência.' })).toBeVisible();
    const plans = page.locator('#planos');
    await expect(plans.getByText('R$ 250', { exact: true })).toBeVisible();
    await plans.getByRole('radio', { name: /Anual/ }).click();
    await expect(plans.getByText('R$ 2.500', { exact: true })).toBeVisible();
    await expect(plans.getByRole('link', { name: 'Assinar o Pro' })).toHaveAttribute('href', '/cadastro?plano=pro&periodo=anual');
  });

  test('cadastro → e-mail → confirmação → configuração inicial com o plano pendente', async ({ page }) => {
    const email = `cadastro-${Date.now()}@e2e.test`;
    await signup(page, email, 'senha-do-cadastro-1');

    // Antes de confirmar, o login avisa que falta o e-mail.
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill('senha-do-cadastro-1');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Confirme seu e-mail');

    await page.goto(await lastEmailLink(email, '/confirmar-email'));
    await expect(page).toHaveURL(/\/app\/onboarding/);
    await expect(page.getByText('Escolha um plano para ativar o atendimento automático.')).toBeVisible();

    await page.goto('/app/settings/billing');
    await expect(page.getByText('Aguardando pagamento')).toBeVisible();
    await expect(page.getByText('Starter', { exact: true })).toBeVisible();
  });

  test('esqueci a senha → link → nova senha → entra com a senha nova', async ({ page }) => {
    const email = `senha-${Date.now()}@e2e.test`;
    await signup(page, email, 'senha-original-123');
    await page.goto(await lastEmailLink(email, '/confirmar-email'));
    await expect(page).toHaveURL(/\/app/);
    await page.context().clearCookies();

    await page.goto('/esqueci-senha');
    await page.getByLabel('E-mail').fill(email);
    await page.getByRole('button', { name: 'Enviar link' }).click();
    await expect(page.getByText('o link chega em instantes')).toBeVisible();

    await page.goto(await lastEmailLink(email, '/redefinir-senha'));
    await page.getByLabel('Nova senha', { exact: true }).fill('senha-nova-456789');
    await page.getByLabel('Repita a nova senha').fill('senha-nova-456789');
    await page.getByRole('button', { name: 'Salvar nova senha' }).click();
    await expect(page.getByText('Senha alterada. Entre com a nova senha.')).toBeVisible();

    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha').fill('senha-nova-456789');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/app/);
  });
});
