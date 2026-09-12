import DhabasAlongRoutePage from '@/components/dhabas/DhabasAlongRoutePage'

type SearchParams = Record<string, string | string[] | undefined>

const allowedParams = ['mode', 'from', 'to', 'fromLocationId', 'toLocationId', 'near', 'nearLocationId', 'date']

export default async function DhabasPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const values = await searchParams
  const query = new URLSearchParams()

  for (const name of allowedParams) {
    const value = values[name]
    if (typeof value === 'string' && value) query.set(name, value)
  }

  return <DhabasAlongRoutePage query={query.toString()} />
}
