// Utilitário de desenvolvimento: faz login e captura telas do painel (não faz parte dos testes).
import { chromium } from '@playwright/test';

const [, , email = 'dono@clinicademo.local', password = 'demo-senha-123', out = './shots', ...paths] = process.argv;
const browser = await chromium.launch();
for (const viewport of [{ width: 1440, height: 900, name: 'desktop' }, { width: 390, height: 844, name: 'mobile' }].slice(0, process.env.MOBILE ? 2 : 1)) {
  const page = await browser.newPage({ viewport });
  await page.goto('http://localhost:3000/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/(app|platform)/);
  for (const path of paths) {
    await page.goto(`http://localhost:3000${path}`);
    await page.waitForTimeout(2500);
    const file = `${out}/${viewport.name}${path.replaceAll('/', '_') || '_root'}.png`;
    await page.screenshot({ path: file, fullPage: false });
    console.log(file);
  }
  await page.close();
}
await browser.close();
