'use client';

import type { CompanyPermission, PlatformPermission } from '@botsaas/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; email: string; name: string; mustChangePassword: boolean };
  platformRole: string | null;
  platformPermissions: PlatformPermission[];
  memberships: { companyId: string; companyName: string; role: string; status: string }[];
  activeCompany: {
    id: string;
    name: string;
    status: string;
    templateKey: string;
    onboardingDone: boolean;
    role: string;
    permissions: CompanyPermission[];
  } | null;
  supportMode: { companyId: string; expiresAt: string } | null;
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/auth/me'),
    retry: (count, error) => !(error instanceof ApiError && error.status === 401) && count < 2,
    staleTime: 60_000,
  });
}

/** Redireciona para o login quando a sessão não existe/expirou. */
export function useRequireSession() {
  const me = useMe();
  const router = useRouter();
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) router.replace('/login');
  }, [me.error, router]);
  return me;
}

export function useCan() {
  const { data } = useMe();
  const permissions = new Set(data?.activeCompany?.permissions ?? []);
  return (permission: CompanyPermission) => permissions.has(permission);
}

export function useCanPlatform() {
  const { data } = useMe();
  const permissions = new Set(data?.platformPermissions ?? []);
  return (permission: PlatformPermission) => permissions.has(permission);
}

export function useLogout() {
  const client = useQueryClient();
  const router = useRouter();
  return async () => {
    await api.post('/auth/logout').catch(() => undefined);
    client.clear();
    router.replace('/login');
  };
}
