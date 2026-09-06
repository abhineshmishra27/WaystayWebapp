import { setTimeout as sleep } from 'node:timers/promises'

/**
 * Creates and destroys throwaway Neon branches so route tests run against a real
 * database rather than a mock.
 *
 * A mock would not have caught anything that actually went wrong here: the duplicate
 * guard, the capacity rules and the slot patterns are all about real SQL behaviour, and
 * search depends on PostGIS and pg_trgm. A branch is a copy-on-write clone of the dev
 * database, so it has those extensions and the real schema without a fixture pipeline.
 */

const NEON_API = 'https://console.neon.tech/api/v2'
const ENDPOINT_READY_TIMEOUT_MS = 90_000

function requireEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is required for route tests. NEON_API_KEY comes from ` +
        'console.neon.tech > Account settings > API keys; the project id is already in .env.local.',
    )
  }
  return value
}

async function neonRequest(path, options = {}) {
  const response = await fetch(`${NEON_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${requireEnv('NEON_API_KEY')}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers ?? {}),
    },
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Neon ${options.method ?? 'GET'} ${path} failed (${response.status}): ${text.slice(0, 300)}`)
  }
  return text ? JSON.parse(text) : null
}

/**
 * Branch names are prefixed so a crashed run leaves something obviously disposable
 * behind rather than a mystery branch nobody dares delete.
 */
export function testBranchName() {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export async function createTestBranch() {
  const projectId = requireEnv('WAYSTAY_NEON_PROJECT_ID')
  const name = testBranchName()

  const created = await neonRequest(`/projects/${projectId}/branches`, {
    method: 'POST',
    body: JSON.stringify({
      branch: { name },
      endpoints: [{ type: 'read_write' }],
    }),
  })

  const branchId = created?.branch?.id
  // Neon returns the pooled and direct URIs here; prefer a direct one, since migrations
  // and DDL do not belong on a pooled connection.
  const uri =
    created?.connection_uris?.find(entry => !entry.connection_uri.includes('-pooler'))?.connection_uri
    ?? created?.connection_uris?.[0]?.connection_uri

  if (!branchId || !uri) {
    throw new Error('Neon did not return a branch id and connection URI')
  }

  await waitForBranchReady(projectId, branchId)
  return { projectId, branchId, name, connectionUri: uri }
}

/**
 * A freshly created endpoint reports itself before it accepts connections, so the first
 * queries would fail with a confusing connection error rather than a clear one.
 */
async function waitForBranchReady(projectId, branchId) {
  const deadline = Date.now() + ENDPOINT_READY_TIMEOUT_MS

  while (Date.now() < deadline) {
    const endpoints = await neonRequest(`/projects/${projectId}/branches/${branchId}/endpoints`)
    const states = (endpoints?.endpoints ?? []).map(endpoint => endpoint.current_state)
    if (states.length > 0 && states.every(state => state === 'active' || state === 'idle')) return
    await sleep(2000)
  }

  throw new Error(`Neon branch ${branchId} did not become ready within ${ENDPOINT_READY_TIMEOUT_MS}ms`)
}

/** Best-effort: a failed cleanup must not fail an otherwise passing test run. */
export async function deleteTestBranch(branch) {
  if (!branch?.projectId || !branch?.branchId) return
  try {
    await neonRequest(`/projects/${branch.projectId}/branches/${branch.branchId}`, { method: 'DELETE' })
  } catch (error) {
    console.error(`Could not delete test branch ${branch.name}: ${error.message}`)
    console.error('Delete it by hand at console.neon.tech to avoid accumulating branches.')
  }
}
