import { assertTestDatabaseUrl, migrateTestDatabase } from '@botsaas/database/testing';
import { TEST_DATABASE_URL } from './test-env';

export default function setup() {
  assertTestDatabaseUrl(TEST_DATABASE_URL);
  migrateTestDatabase(TEST_DATABASE_URL);
}
