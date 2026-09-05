/**
 * One place that decides which database a script talks to.
 *
 * This exists because the scripts had drifted into five different answers: some read
 * DATABASE_URL only, some DIRECT_URL then DATABASE_URL, some loaded .env but not
 * .env.local. When the project moved databases, the stale URL stayed behind in .env and
 * those scripts kept pointing at a decommissioned server - failing in confusing ways, or
 * worse, quietly succeeding against the wrong data.
 *
 * Order matches prisma.config.ts: scripts do one-off reads and writes, so the direct
 * (unpooled) endpoint is preferred over the pooled one.
 */

const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')

// .env.local first: dotenv keeps the first value it sees, so the local override wins.
require('dotenv').config({ path: path.join(projectRoot, '.env.local') })
require('dotenv').config({ path: path.join(projectRoot, '.env') })

const CANDIDATES = [
  'WAYSTAY_DATABASE_URL_UNPOOLED',
  'WAYSTAY_DATABASE_URL',
  'DIRECT_URL',
  'DATABASE_URL',
]

function stripQuotes(value) {
  return value.replace(/(^"|"$)/g, '')
}

/** Resolves the connection string, or throws with the list of names that were tried. */
function resolveDatabaseUrl() {
  for (const name of CANDIDATES) {
    const value = process.env[name]
    if (value && value.trim()) return stripQuotes(value.trim())
  }
  throw new Error(
    `No database connection string found. Set one of: ${CANDIDATES.join(', ')} ` +
      'in .env.local (preferred) or .env',
  )
}

/** Host and database name only - safe to print, never includes credentials. */
function describeDatabaseTarget(connectionString = resolveDatabaseUrl()) {
  try {
    const url = new URL(connectionString)
    return `${url.host}${url.pathname}`
  } catch {
    return '(unparseable connection string)'
  }
}

module.exports = { resolveDatabaseUrl, describeDatabaseTarget }
