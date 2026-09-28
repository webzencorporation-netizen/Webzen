import { expect, test, type Page } from '@playwright/test';

/** O backend é coberto pela suíte API; aqui verificamos modal e recuperação do cache. */
async function mockPasswordSession(page: Page, hasCompany: boolean) {
  let mustChangePassword = true;
  let loggedOut = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') {
      if (loggedOut)
        return route.fulfill({
          status: 401,
          json: { error: { message: 'Autenticação necessária.' } },
        });
      return route.fulfill({
        json: {
          user: {
            id: 'owner',
            name: 'Pessoa Provisória',
            email: 'temporary@example.test',
            mustChangePassword,
          },
          platformRole: null,
          platformPermissions: [],
          supportMode: null,
          memberships: hasCompany
            ? [
                {
                  companyId: 'company',
                  companyName: 'Empresa Teste',
                  role: 'COMPANY_OWNER',
                  status: 'ACTIVE',
                },
              ]
            : [],
          activeCompany: hasCompany
            ? {
                id: 'company',
                name: 'Empresa Teste',
                status: 'ACTIVE',
                templateKey: 'GENERAL',
                onboardingDone: true,
                role: 'COMPANY_OWNER',
                permissions: ['contacts:read', 'company:read'],
              }
            : null,
        },
      });
    }
    if (path === '/api/auth/change-password') {
      expect(route.request().postDataJSON()).toEqual({
        currentPassword: 'senha-provisoria-123',
        newPassword: 'senha-definitiva-321',
      });
      mustChangePassword = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === '/api/auth/logout') {
      loggedOut = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (mustChangePassword) {
      return route.fulfill({
        status: 403,
        json: {
          error: {
            code: 'AUTHORIZATION_ERROR',
            message: 'Troque sua senha temporária antes de continuar.',
            details: { reason: 'PASSWORD_CHANGE_REQUIRED' },
          },
        },
      });
    }
    if (path === '/api/app/contacts') {
      return route.fulfill({
        json: {
          page: 1,
          pageSize: 25,
          total: 1,
          items: [
            {
              id: 'contact',
              name: 'Contato recuperado',
              phone: '5511999991111',
              tags: [],
              assignee: null,
              source: 'manual',
              lastInteractionAt: null,
            },
          ],
        },
      });
    }
    if (path === '/api/app/notifications') return route.fulfill({ json: { unread: 0, items: [] } });
    return route.fulfill({ json: [] });
  });
}

async function changePassword(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Defina uma nova senha' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Senha atual', { exact: true }).fill('senha-provisoria-123');
  await dialog.getByLabel('Nova senha', { exact: true }).fill('senha-definitiva-321');
  await dialog.getByLabel('Confirme a nova senha', { exact: true }).fill('senha-definitiva-321');
  await dialog.getByRole('button', { name: 'Salvar senha' }).click();
  await expect(dialog).not.toBeVisible();
}

test('troca obrigatória recupera dados protegidos sem recarregar a página', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockPasswordSession(page, true);
  const blocked = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/app/contacts' && response.status() === 403,
  );
  await page.goto('/app/contacts');
  await blocked;
  await changePassword(page);
  await expect(page.getByText('Contato recuperado', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('conta sem empresa pode trocar senha e sair pelo menu existente', async ({ page }) => {
  await mockPasswordSession(page, false);
  await page.goto('/app');
  await changePassword(page);
  await expect(page.getByText('Sua conta ainda não está vinculada a uma empresa.')).toBeVisible();
  await page.getByRole('button', { name: /Pessoa Provisória/ }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);
});
