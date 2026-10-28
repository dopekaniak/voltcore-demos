import { loadDotenv } from './dotenv';

loadDotenv();
// Tests always run against the test database.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
