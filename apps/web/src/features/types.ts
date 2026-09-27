/** Tipos das respostas da API usados no painel. */

export interface Tag {
  id: string;
  name: string;
  color: string;
}

export interface ConversationListItem {
  id: string;
  contact: { id: string; name: string | null; phone: string; tags: Tag[] };
  assignee: { id: string; name: string } | null;
  mode: 'AI' | 'HUMAN' | 'PAUSED';
  status: 'OPEN' | 'WAITING_HUMAN' | 'CLOSED';
  unreadCount: number;
  needsAttention: boolean;
  attentionReason: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  window: { isOpen: boolean; expiresAt: string | null; requiresTemplate: boolean };
}

export interface ConversationDetail extends ConversationListItem {
  whatsappAccount: { displayPhoneNumber: string | null; verifiedName: string | null } | null;
  lead: { id: string; stage: { id: string; key: string; name: string; color: string }; qualification: Record<string, unknown> | null } | null;
  openHandoff: { id: string; reason: string; requestedBy: string; createdAt: string } | null;
}

export interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  sender: 'CONTACT' | 'AI' | 'AGENT' | 'SYSTEM';
  type: string;
  text: string | null;
  payload: Record<string, unknown> | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  senderUser: { id: string; name: string } | null;
  media: { id: string; kind: string; mimeType: string | null; fileName: string | null; caption: string | null; transcription: string | null; processingStatus: string; available: boolean }[];
}

export interface Contact {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  source: string | null;
  status: string | null;
  assignee: { id: string; name: string } | null;
  tags: Tag[];
  customFields: Record<string, unknown>;
  lastInteractionAt: string | null;
  nextActionAt: string | null;
  nextActionNote: string | null;
  optedOut: boolean;
  createdAt: string;
}

export interface Member {
  id: string;
  role: string;
  isActive: boolean;
  user: { id: string; name: string; email: string; lastLoginAt: string | null };
}

export interface LeadStage {
  id: string;
  key: string;
  name: string;
  color: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  _count?: { leads: number };
}

export interface Lead {
  id: string;
  title: string | null;
  valueCents: number | null;
  qualification: Record<string, unknown> | null;
  position: number;
  createdAt: string;
  closedAt: string | null;
  contact: { id: string; name: string | null; phone: string; tags: { tag: Tag }[] };
  assignee: { id: string; name: string } | null;
  stage: { id: string; key: string; name: string; color: string };
}

export interface CustomField {
  id: string;
  target: 'CONTACT' | 'LEAD';
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'SELECT' | 'BOOLEAN' | 'DATE';
  options: string[];
  collectByAgent: boolean;
  agentHint: string | null;
}

export interface UsageStatus {
  state: 'NORMAL' | 'WARNING' | 'LIMIT_REACHED';
  metrics: { metric: string; label: string; current: number; limit: number | null; warningPercent: number; state: string }[];
}
