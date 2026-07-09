import { defineConfig } from 'prisma/config';

// Prisma 7 reads the connection URL from here instead of the schema.
// `prisma generate` does not need a live database, so we read the variable
// directly (it may be undefined during generation); the runtime client in
// `src/index.ts` hard-requires DATABASE_URL and fails fast if it is missing.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
});
