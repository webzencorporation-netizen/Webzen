import type { MessageType } from '@botsaas/database';

const LABELS: Partial<Record<MessageType, string>> = {
  IMAGE: '📷 Imagem',
  AUDIO: '🎤 Áudio',
  VIDEO: '🎬 Vídeo',
  DOCUMENT: '📄 Documento',
  STICKER: 'Figurinha',
  LOCATION: '📍 Localização',
  CONTACTS: '👤 Contato',
  REACTION: 'Reação',
  TEMPLATE: 'Mensagem de template',
  UNSUPPORTED: 'Mensagem não suportada',
};

export function messagePreview(type: MessageType, text: string | null | undefined): string {
  const clean = text?.replace(/\s+/g, ' ').trim();
  if (clean) return clean.slice(0, 140);
  return LABELS[type] ?? '';
}
