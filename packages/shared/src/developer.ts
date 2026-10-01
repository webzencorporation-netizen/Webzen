/** Escopos de uma chave de API (API pública v1). Cada rota exige um escopo. */
export const API_SCOPES = ['contacts:read', 'contacts:write', 'conversations:read', 'messages:send'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const API_SCOPE_LABELS: Record<ApiScope, string> = {
  'contacts:read': 'Ler contatos',
  'contacts:write': 'Criar e atualizar contatos',
  'conversations:read': 'Ler conversas e mensagens',
  'messages:send': 'Enviar mensagens pelo WhatsApp',
};

/**
 * Eventos entregues por webhook. Nomes públicos e estáveis: não mudam quando os eventos
 * internos mudam de nome. Ver `DOMAIN_TO_WEBHOOK_EVENT` na API.
 */
export const WEBHOOK_EVENTS = [
  'contact.created',
  'conversation.created',
  'conversation.completed',
  'conversation.handoff_requested',
  'message.received',
  'message.sent',
  'lead.created',
  'lead.stage_changed',
  'appointment.created',
  'appointment.cancelled',
  'bot.error',
  'subscription.updated',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  'contact.created': 'Contato criado',
  'conversation.created': 'Conversa iniciada',
  'conversation.completed': 'Conversa encerrada',
  'conversation.handoff_requested': 'Atendimento humano solicitado',
  'message.received': 'Mensagem recebida',
  'message.sent': 'Mensagem enviada',
  'lead.created': 'Lead criado',
  'lead.stage_changed': 'Lead mudou de etapa',
  'appointment.created': 'Agendamento criado',
  'appointment.cancelled': 'Agendamento cancelado',
  'bot.error': 'Erro no atendimento automático',
  'subscription.updated': 'Assinatura atualizada',
};
