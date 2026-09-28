import prepareDatabase from './global-setup';

// O primeiro webServer só fica disponível após reset, migração e seed.
// Importar main mantém a API no processo Node gerenciado pelo Playwright.
await prepareDatabase();
await import(new URL('../../api/src/main.ts', import.meta.url).href);
