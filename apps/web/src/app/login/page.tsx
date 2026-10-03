import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/account/login-form';

export const metadata: Metadata = {
  title: 'Entrar',
  description: 'Acesse o painel da sua empresa no WebZen.',
  alternates: { canonical: '/login' },
};

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
