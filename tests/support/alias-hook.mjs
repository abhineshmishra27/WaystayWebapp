import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

/**
 * Teaches the node test runner the `@/*` -> `src/*` path alias from tsconfig.
 *
 * Source files use `@/lib/...` throughout, and rewriting them to relative paths just to
 * satisfy the test runner would make the tested code less like the code that ships.
 * This hook resolves the alias the same way tsc and Next do, so any module can be unit
 * tested without changing how it is written.
 */

const projectRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sourceRoot = resolvePath(projectRoot, 'src')

// TypeScript imports omit the file extension, so try the same candidates tsc would.
const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '/index.ts', '/index.tsx']

function resolveSourceFile(basePath) {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${basePath}${suffix}`
    if (suffix !== '' && existsSync(candidate)) return candidate
    if (suffix === '' && existsSync(candidate) && candidate.includes('.')) return candidate
  }
  return null
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@' || specifier.startsWith('@/')) {
      const basePath = resolvePath(sourceRoot, specifier === '@' ? '' : specifier.slice(2))
      const resolved = resolveSourceFile(basePath)
      if (resolved) return nextResolve(pathToFileURL(resolved).href, context)
    }
    return nextResolve(specifier, context)
  },
})
