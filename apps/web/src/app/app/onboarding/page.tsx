import type { Metadata } from 'next';
import { OnboardingPage } from '@/features/onboarding/onboarding-page';

export const metadata: Metadata = { title: 'Configuração inicial' };

export default function Page() {
  return <OnboardingPage />;
}
