import { systemDb } from '@botsaas/database';

/**
 * Usuários são globais (um usuário pode pertencer a várias empresas), por isso o acesso
 * ao modelo User fica isolado aqui com operações mínimas e sem expor dados de outras empresas.
 */
export function findUserByEmail(email: string) {
  return systemDb.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
}

export function createCompanyUser(input: {
  email: string;
  name: string;
  passwordHash: string;
  mustChangePassword: boolean;
}) {
  // Criado por quem administra a empresa/plataforma: o e-mail é confiável desde o início.
  return systemDb.user.create({
    data: { ...input, emailVerifiedAt: new Date() },
    select: { id: true, email: true, name: true },
  });
}
