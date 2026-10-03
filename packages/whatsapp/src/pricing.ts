/**
 * Preço de REFERÊNCIA por mensagem cobrável (USD), mercado Brasil, por categoria de cobrança
 * informada pela Meta no status (`pricing.category`).
 *
 * Fonte (conferida em 2026-09-29): página oficial de preços de mensagens sem template — a partir
 * de 2026-10-01 cada mensagem de serviço é cobrada ao mesmo preço de utility/authentication do
 * mercado; o exemplo citado para o Brasil é 0,68 centavo de dólar (tabela de 2026-07-01).
 * A tabela que vale em 2026-10-01 é publicada à parte: confira e sobrescreva com
 * `WHATSAPP_PRICE_USD`. Categorias sem preço aqui (ex.: marketing) ficam SEM custo estimado
 * e são contadas como "sem preço" — nada é inventado.
 */
export const WHATSAPP_REFERENCE_PRICES_USD: Readonly<Record<string, number>> = {
  service: 0.0068,
  utility: 0.0068,
  authentication: 0.0068,
};

/** Tabela efetiva: referência + valores configurados no ambiente (que prevalecem). */
export function whatsappPriceTable(overrides?: Record<string, number>): Record<string, number> {
  return { ...WHATSAPP_REFERENCE_PRICES_USD, ...overrides };
}
