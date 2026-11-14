/**
 * Connections to the throwaway test database of docker-compose.test.yml.
 * These are local test values, not secrets. FAHIM_TEST_DB_ADMIN_URL overrides the server.
 */
export const ADMIN_SERVER_URL = process.env.FAHIM_TEST_DB_ADMIN_URL ?? 'postgres://postgres:fahim_test_only@127.0.0.1:55432';
export const TEST_DB = 'fahim_test';
export const ADMIN_URL = `${ADMIN_SERVER_URL}/${TEST_DB}`;
export const APP_PASSWORD = 'fahim_app_test_only';
const host = new URL(ADMIN_SERVER_URL).host;
export const APP_URL = `postgres://fahim_app:${APP_PASSWORD}@${host}/${TEST_DB}`;
