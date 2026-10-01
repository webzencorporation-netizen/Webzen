import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SignupForm } from '@/features/account/signup-form';

export const metadata: Metadata = {
  title: 'Criar conta',
  description: 'Crie a conta da sua empresa no WebZen e configure seu atendente com IA no WhatsApp.',
  alternates: { canonical: '/cadastro' },
};

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
