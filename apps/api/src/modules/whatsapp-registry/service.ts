import { systemDb } from '@botsaas/database';

/** phone_number_id é único na PLATAFORMA (identifica a empresa no webhook). */
export async function isPhoneNumberIdTaken(phoneNumberId: string): Promise<boolean> {
  return (
    (await systemDb.whatsAppAccount.findUnique({
      where: { phoneNumberId },
      select: { id: true },
    })) !== null
  );
}
