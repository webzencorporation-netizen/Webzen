import { expect, test } from '@playwright/test';
import { login, OWNER, PLATFORM_ADMIN } from './helpers';

test.describe('fluxos críticos', () => {
  test('login inválido mostra erro e login válido abre o painel', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(OWNER);
    await page.getByLabel('Senha').fill('senha-errada-123');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveText('E-mail ou senha inválidos.');

    await login(page, OWNER);
    await expect(page.getByRole('heading', { name: /Olá, Dra\. Helena/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Menu principal' }).getByText('Conversas')).toBeVisible();
  });

  test('rotas protegidas redirecionam para o login', async ({ page }) => {
    await page.goto('/app/contacts');
    await expect(page).toHaveURL(/\/login/);
  });

  test('mensagem simulada chega na inbox, atendente assume, responde e devolve para a IA', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/app/integrations');
    await page.getByLabel('Telefone do cliente').fill('11912345678');
    await page.getByLabel('Nome do cliente').fill('Paula E2E');
    await page.getByLabel('Mensagem', { exact: true }).fill('Olá, gostaria de informações');
    await page.getByRole('button', { name: 'Simular' }).click();
    await expect(page.getByText('Mensagem simulada recebida')).toBeVisible();

    await page.goto('/app/conversations');
    await page.getByText('Paula E2E').first().click();
    await expect(page.getByText('Olá, gostaria de informações')).toBeVisible();
    // O worker processa o agente (mock) após o agrupamento de mensagens.
    await expect(page.getByText('Atendente virtual').first()).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Assumir conversa' }).click();
    await expect(page.getByText('Você assumiu a conversa.')).toBeVisible();
    await page.getByLabel('Mensagem', { exact: true }).fill('Oi Paula, aqui é a Dra. Helena!');
    await page.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(page.getByText('Oi Paula, aqui é a Dra. Helena!')).toBeVisible();

    await page.getByRole('button', { name: 'Devolver para IA' }).click();
    await expect(page.getByText('Conversa devolvida para a IA.')).toBeVisible();
  });

  test('testar agente mostra resposta e detalhes técnicos sem enviar ao WhatsApp', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/app/agent/test');
    await page.getByLabel('Mensagem de teste').fill('qual o horário de funcionamento?');
    await page.getByRole('button', { name: 'Enviar' }).click();
    await expect(page.getByText('[simulação] Consultei nossos dados')).toBeVisible();
    await expect(page.getByText('get_business_hours')).toBeVisible();
  });

  test('administrador da plataforma cria empresa e recebe senha temporária', async ({ page }) => {
    await login(page, PLATFORM_ADMIN);
    await page.goto('/platform');
    await page.getByRole('button', { name: 'Nova empresa' }).click();
    await page.getByLabel('Nome da empresa').fill('Barbearia E2E');
    await page.getByLabel('Segmento (template)').selectOption('BARBERSHOP_BEAUTY');
    await page.getByLabel('Nome do responsável').fill('Carlos Barbeiro');
    await page.getByLabel('E-mail do responsável').fill('carlos@barbearia-e2e.local');
    await page.getByRole('button', { name: 'Criar empresa' }).click();
    await expect(page.getByText('Senha temporária do responsável')).toBeVisible();
    await page.getByRole('link', { name: 'Abrir empresa' }).click();
    await expect(page.getByRole('heading', { name: 'Barbearia E2E' })).toBeVisible();
  });

  test('usuário de empresa não acessa a área da plataforma', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/platform');
    await expect(page).toHaveURL(/\/app$/);
  });
});
