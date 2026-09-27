/**
 * Textos de interface em pt-BR. Rótulos de enums centralizados aqui para facilitar i18n futuro
 * (trocar este módulo por um carregador de idiomas).
 */
export const roleLabels: Record<string, string> = {
  COMPANY_OWNER: 'Proprietário',
  COMPANY_ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  ATTENDANT: 'Atendente',
  VIEWER: 'Somente leitura',
  PLATFORM_OWNER: 'Dono da plataforma',
  PLATFORM_ADMIN: 'Admin da plataforma',
};

export const modeLabels: Record<string, string> = { AI: 'IA', HUMAN: 'Humano', PAUSED: 'IA pausada' };

export const conversationStatusLabels: Record<string, string> = {
  OPEN: 'Aberta',
  WAITING_HUMAN: 'Aguardando equipe',
  CLOSED: 'Encerrada',
};

export const companyStatusLabels: Record<string, string> = {
  ONBOARDING: 'Em configuração',
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  CANCELLED: 'Cancelada',
};

export const appointmentStatusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  CANCELLED: 'Cancelado',
  COMPLETED: 'Concluído',
  NO_SHOW: 'Não compareceu',
};

export const messageStatusLabels: Record<string, string> = {
  RECEIVED: 'Recebida',
  QUEUED: 'Enviando',
  SENT: 'Enviada',
  DELIVERED: 'Entregue',
  READ: 'Lida',
  FAILED: 'Falhou',
};

export const templateLabels: Record<string, string> = {
  GENERAL: 'Geral',
  CLINIC: 'Clínica / Consultório',
  BARBERSHOP_BEAUTY: 'Barbearia / Salão',
  RESTAURANT: 'Restaurante',
  RETAIL_STORE: 'Loja / Varejo',
  REAL_ESTATE: 'Imobiliária',
  LOCAL_SERVICE: 'Serviços locais',
};

export const toneLabels: Record<string, string> = { FORMAL: 'Formal', FRIENDLY: 'Amigável', CASUAL: 'Casual', OBJECTIVE: 'Objetivo' };
export const lengthLabels: Record<string, string> = { SHORT: 'Curto', MEDIUM: 'Médio', DETAILED: 'Detalhado' };
export const emojiLabels: Record<string, string> = { NEVER: 'Nunca', MODERATE: 'Moderado', FREE: 'Livre' };
export const effortLabels: Record<string, string> = { low: 'Rápido', medium: 'Equilibrado', high: 'Caprichado' };
export const fallbackLabels: Record<string, string> = {
  HANDOFF_TO_HUMAN: 'Encaminhar para a equipe',
  SEND_FALLBACK_MESSAGE: 'Enviar mensagem de contingência',
  SILENT: 'Apenas sinalizar no painel',
};

export const usageStateLabels: Record<string, string> = { NORMAL: 'Normal', WARNING: 'Atenção', LIMIT_REACHED: 'Limite atingido' };

export const integrationStatusLabels: Record<string, string> = {
  PENDING: 'Pendente',
  CONNECTED: 'Conectado',
  ERROR: 'Com erro',
  DISCONNECTED: 'Desconectado',
  NOT_CONFIGURED: 'Não configurado',
};

export const knowledgeTypeLabels: Record<string, string> = {
  TEXT: 'Texto',
  FAQ: 'Pergunta frequente',
  POLICY: 'Política',
  COMPANY_INFO: 'Informação da empresa',
  DOCUMENT: 'Documento',
};

export const automationTriggerLabels: Record<string, string> = {
  'contact.created': 'Novo contato',
  'conversation.created': 'Nova conversa',
  'message.received': 'Mensagem recebida',
  'lead.stage_changed': 'Lead mudou de etapa',
  'appointment.created': 'Agendamento criado',
  'appointment.cancelled': 'Agendamento cancelado',
  'handoff.requested': 'Atendimento humano solicitado',
  'appointment.reminder_due': 'Consulta amanhã (lembrete)',
};

export const featureLabels: Record<string, string> = {
  AI_AGENT: 'Atendente virtual',
  CRM: 'CRM',
  CALENDAR: 'Agenda',
  AUTOMATIONS: 'Automações',
  ADVANCED_ANALYTICS: 'Relatórios avançados',
  KNOWLEDGE_UPLOADS: 'Upload de documentos',
};

export const weekdayLabels = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
