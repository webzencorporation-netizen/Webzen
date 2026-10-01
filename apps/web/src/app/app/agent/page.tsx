import type { Metadata } from 'next';
import { AgentSettings } from '@/features/agent/agent-settings';

export const metadata: Metadata = { title: 'Agente de IA' };

export default function AgentPage() {
  return <AgentSettings />;
}
