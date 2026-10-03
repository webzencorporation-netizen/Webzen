import type { Metadata } from 'next';
import { AgentTester } from '@/features/agent/agent-tester';

export const metadata: Metadata = { title: 'Testar agente' };

export default function AgentTestPage() {
  return <AgentTester />;
}
