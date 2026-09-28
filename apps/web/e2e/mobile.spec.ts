import { expect, test } from '@playwright/test';
import { login, OWNER } from './helpers';

test('inbox utilizável no celular: lista → conversa → voltar', async ({ page }) => {
  await login(page, OWNER);
  await page.goto('/app/conversations');
  await page.getByText('João Pereira').first().click();
  await expect(page.getByText('Tenho sábado às 10h ou 11h')).toBeVisible();
  await expect(page.getByLabel('Mensagem', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Voltar para a lista' }).click();
  await expect(page.getByLabel('Buscar conversas')).toBeVisible();
});
