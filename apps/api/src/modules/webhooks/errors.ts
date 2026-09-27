import { AppError, ERROR_CODES } from '@botsaas/shared';

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Integração não configurada.') {
    super(ERROR_CODES.INTEGRATION, 503, message);
  }
}
