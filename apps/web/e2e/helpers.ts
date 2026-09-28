import { expect, type Page } from '@playwright/test';
import { PASSWORD } from './fixtures';

export { PASSWORD, OWNER, PLATFORM_ADMIN } from './fixtures';

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/(app|platform)/);
}
