import type { Metadata } from 'next';
import { TeamPage } from '@/features/team/team-page';

export const metadata: Metadata = { title: 'Equipe' };

export default function Page() {
  return <TeamPage />;
}
