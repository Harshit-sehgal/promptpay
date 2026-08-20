#!/usr/bin/env node
/**
 * Provision and clean up an isolated PostgreSQL schema for the staging gate.
 *
 * A schema is used instead of a database so the release workflow can isolate
 * each run without requiring a cloud-specific database API. The generated
 * name is run-scoped and is the only object this script ever drops.
 *
 * Commands:
 *   provision - create the schema and write its name to GITHUB_OUTPUT
 *   url       - print STAGING_DATABASE_URL with ?schema=<name>
 *   destroy   - drop only the named schema with CASCADE
 */

import { createRequire } from 'module';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(new URL('.', import.meta.url)));
const requireFromDb = createRequire(join(__dirname, '..', 'packages', 'db', 'package.json'));
const { Pool } = requireFromDb('pg');
const { appendFileSync } = requireFromDb('fs');

const operation = process.argv[2];
const baseUrl = process.env.STAGING_DATABASE_URL;
const schema = process.env.STAGING_DATABASE_SCHEMA;

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function getDatabaseUrl() {
  if (!baseUrl) throw new Error('STAGING_DATABASE_URL is required');
  if (!schema || !/^ateva_staging_[a-z0-9_]+$/.test(schema)) {
    throw new Error('STAGING_DATABASE_SCHEMA is missing or invalid');
  }
  const url = new URL(baseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

function writeOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath) {
    // GitHub output values are generated locally and never include a password.
    appendFileSync(outputPath, `${name}=${value}\n`);
  }
}

async function main() {
  if (!['provision', 'url', 'destroy'].includes(operation)) {
    throw new Error('Usage: staging-database.mjs <provision|url|destroy>');
  }

  if (operation === 'url') {
    process.stdout.write(`${getDatabaseUrl()}\n`);
    return;
  }

  if (operation === 'provision') {
    if (!baseUrl) throw new Error('STAGING_DATABASE_URL is required');
    const generated = `ateva_staging_${process.env.GITHUB_RUN_ID ?? Date.now()}_${process.env.GITHUB_RUN_ATTEMPT ?? 1}`;
    if (!/^ateva_staging_[a-z0-9_]+$/.test(generated)) {
      throw new Error('Generated staging schema name is invalid');
    }
    const pool = new Pool({ connectionString: baseUrl, max: 1 });
    try {
      await pool.query(`CREATE SCHEMA ${quoteIdentifier(generated)}`);
    } finally {
      await pool.end();
    }
    writeOutput('schema', generated);
    console.log(`Provisioned isolated staging schema ${generated}`);
    return;
  }

  if (!baseUrl) throw new Error('STAGING_DATABASE_URL is required');
  if (!schema || !/^ateva_staging_[a-z0-9_]+$/.test(schema)) {
    throw new Error('STAGING_DATABASE_SCHEMA is missing or invalid');
  }
  const pool = new Pool({ connectionString: baseUrl, max: 1 });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
  } finally {
    await pool.end();
  }
  console.log(`Destroyed isolated staging schema ${schema}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
