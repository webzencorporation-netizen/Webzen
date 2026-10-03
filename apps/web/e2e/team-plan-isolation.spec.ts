import { expect, test, type Page } from '@playwright/test';
import { lastEmailLink, login, OWNER, signup } from './helpers';

/** Cria uma empresa nova (plano Starter) pelo cadastro e entra no painel já confirmada. */
async function newCompany(page: Page, prefix: string): Promise<string> {
  const email = `${prefix}-${Date.now()}@e2e.test`;
  await signup(page, email, 'senha-do-dono-123');
  await page.goto(await lastEmailLink(email, '/confirmar-email'));
  await expect(page).toHaveURL(/\/app/);
  return email;
}

async function invite(page: Page, email: string, role: string) {
  await page.goto('/app/team');
  await page.getByRole('button', { name: 'Convidar pessoa' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convidar pessoa para a equipe' });
  await dialog.getByLabel('E-mail').fill(email);
  await dialog.getByLabel('Papel').selectOption({ label: role });
  await dialog.getByRole('button', { name: 'Enviar convite' }).click();
}

test.describe('equipe, plano e isolamento', () => {
  test('convite → aceite com conta nova → atendente só vê o que o papel permite', async ({ page, browser }) => {
    await newCompany(page, 'equipe');
    const member = `atendente-${Date.now()}@e2e.test`;
    await invite(page, member, 'Atendente');
    await expect(page.getByText(`Convite enviado para ${member}.`)).toBeVisible();
    await expect(page.getByText('Convites pendentes')).toBeVisible();

    // A pessoa convidada abre o link em outro navegador, sem conta.
    const guest = await browser.newContext();
    const guestPage = await guest.newPage();
    await guestPage.goto(await lastEmailLink(member, '/convite'));
    await expect(guestPage.getByText('Você foi convidado para a equipe da Ateliê E2E como atendente.')).toBeVisible();
    await guestPage.getByLabel('Seu nome').fill('Bia Atendente');
    await guestPage.getByLabel('Senha').fill('senha-da-bia-123');
    await guestPage.getByRole('button', { name: 'Criar conta e entrar na equipe' }).click();
    await expect(guestPage).toHaveURL(/\/app$/);

    const nav = guestPage.getByRole('navigation', { name: 'Menu principal' });
    await expect(nav.getByText('Conversas')).toBeVisible();
    await expect(nav.getByText('Equipe')).toHaveCount(0);
    await expect(nav.getByText('Agente de IA')).toHaveCount(0);
    // O convite não pode ser usado de novo.
    await guestPage.goto(await lastEmailLink(member, '/convite'));
    await expect(guestPage.getByRole('heading', { name: 'Convite indisponível' })).toBeVisible();
    await guest.close();

    // Para o dono, a pessoa aparece na equipe e o convite sai da lista de pendentes.
    await page.goto('/app/team');
    await expect(page.getByText('Bia Atendente')).toBeVisible();
    await expect(page.getByText('Convites pendentes')).toHaveCount(0);
  });

  test('limite de usuários do plano abre o aviso de upgrade', async ({ page }) => {
    await newCompany(page, 'limite');
    // Starter: 3 usuários. Dono + 2 convites pendentes ocupam o plano.
    await invite(page, `um-${Date.now()}@e2e.test`, 'Atendente');
    await expect(page.getByText(/Convite enviado para um-/)).toBeVisible();
    await invite(page, `dois-${Date.now()}@e2e.test`, 'Atendente');
    await expect(page.getByText(/Convite enviado para dois-/)).toBeVisible();

    await invite(page, `tres-${Date.now()}@e2e.test`, 'Atendente');
    const upgrade = page.getByRole('dialog', { name: 'Seu plano chegou ao limite' });
    await expect(upgrade).toBeVisible();
    await expect(upgrade.getByText('Limite do plano atingido: Usuários (3).')).toBeVisible();
    await upgrade.getByRole('link', { name: 'Ver planos' }).click();
    await expect(page).toHaveURL(/\/app\/settings\/billing$/);
  });

  test('empresa não abre contato nem conversa de outra empresa pela URL', async ({ page, browser }) => {
    // Ids reais da Clínica Demo, obtidos com a sessão do dono dela.
    const demo = await browser.newContext();
    const demoPage = await demo.newPage();
    await login(demoPage, OWNER);
    type Page1 = { items: { id: string }[] };
    const contacts = (await (await demo.request.get('/api/app/contacts?pageSize=1')).json()) as Page1;
    const conversations = (await (await demo.request.get('/api/app/conversations?filter=all&pageSize=1')).json()) as Page1;
    const contactId = contacts.items[0]?.id;
    const conversationId = conversations.items[0]?.id;
    expect(contactId && conversationId).toBeTruthy();
    await demo.close();

    await newCompany(page, 'isolamento');
    await page.goto(`/app/contacts/${contactId}`);
    await expect(page.getByText('Contato não encontrado')).toBeVisible();

    await page.goto(`/app/conversations/${conversationId}`);
    await expect(page.getByText('Conversa não encontrada')).toBeVisible();

    await page.goto('/app/contacts');
    await expect(page.getByText('Nenhum contato encontrado')).toBeVisible();
  });
});
