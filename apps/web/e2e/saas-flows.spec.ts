import { expect, test } from '@playwright/test';
import { lastEmailLink, signup } from './helpers';

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
