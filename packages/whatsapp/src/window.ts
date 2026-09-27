/**
 * Janela de atendimento (customer service window) da WhatsApp Business Platform.
 *
 * Regra vigente (documentação oficial, set/2026): quando o cliente envia mensagem (ou liga),
 * abre-se uma janela de 24h. Dentro dela a empresa pode enviar mensagens livres ("service
 * messages"); fora dela, somente templates aprovados. A janela reinicia a cada nova mensagem
 * do cliente. Preços são por mensagem entregue e variam por categoria — não calculados aqui.
 *
 * Mantenha esta regra centralizada: se a Meta mudar a duração, altere apenas aqui.
 */
export const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface MessagingWindow {
  /** Mensagem livre permitida agora. */
  isOpen: boolean;
  /** Template aprovado é obrigatório para iniciar/retomar contato. */
  requiresTemplate: boolean;
  /** Quando a janela atual expira (null se nunca houve mensagem do cliente). */
  expiresAt: Date | null;
  /** Milissegundos restantes (0 se fechada). */
  remainingMs: number;
}

export function getMessagingWindow(
  lastInboundAt: Date | null | undefined,
  now: Date = new Date(),
): MessagingWindow {
  if (!lastInboundAt) {
    return { isOpen: false, requiresTemplate: true, expiresAt: null, remainingMs: 0 };
  }
  const expiresAt = new Date(lastInboundAt.getTime() + CUSTOMER_SERVICE_WINDOW_MS);
  const remainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
  const isOpen = remainingMs > 0;
  return { isOpen, requiresTemplate: !isOpen, expiresAt, remainingMs };
}
