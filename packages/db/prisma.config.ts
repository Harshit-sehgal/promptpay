import { defineConfig } from 'prisma/config';

// Prisma 7 reads the connection URL from here instead of the schema.
// Migration/status/drift commands should prefer the direct connection when a
// pooled runtime URL is in use. `prisma generate` does not need a live database,
// so both may be undefined during generation. The runtime client in
// `src/index.ts` intentionally continues to use DATABASE_URL.
const databaseUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: databaseUrl,
  },
});
