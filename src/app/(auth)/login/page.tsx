'use client'
import { useEffect, useState } from 'react'
import { getProviders, signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast, { Toaster } from 'react-hot-toast'

const schema = z.object({
  email: z.string().email('Invalid email'),
  password: z.string().min(1, 'Password required'),
})
type FormData = z.infer<typeof schema>

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({ resolver: zodResolver(schema) })

  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const registered = searchParams.get('registered') === 'true' || searchParams.has('registered')
  const unauthorized = searchParams.get('error') === 'unauthorized'
  const authError = searchParams.get('error')
  const returnTo = searchParams.get('returnTo')
  const redirectTo = returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/hotels'
  const registerHref = returnTo
    ? `/register?returnTo=${encodeURIComponent(redirectTo)}`
    : '/register'

  useEffect(() => {
    getProviders()
      .then(providers => setGoogleEnabled(Boolean(providers?.google)))
      .catch(() => setGoogleEnabled(false))
  }, [])

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    const result = await signIn('credentials', { ...data, redirect: false })
    if (result?.error) {
      toast.error('Invalid email or password')
      setLoading(false)
      return
    }
    router.replace(redirectTo)
    router.refresh()
  }

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    await signIn('google', { redirectTo })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Toaster />
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-100 w-full max-w-md">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Welcome back</h1>
        <p className="text-gray-500 text-sm mb-6">Sign in to your WayStayy account</p>

        {registered && (
          <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3 mb-4">
            Account created! You can now sign in.
          </div>
        )}
        {unauthorized && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
            You do not have permission to access that page.
          </div>
        )}
        {authError && authError !== 'unauthorized' && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 mb-4">
            Google sign-in could not be completed. Please try again or use your password.
          </div>
        )}

        {googleEnabled && (
          <>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading || loading}
              className="w-full border border-gray-200 bg-white text-gray-700 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-3"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
                <path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" />
                <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1a5.8 5.8 0 0 1-5.5-4H3.2v2.6A10 10 0 0 0 12 22Z" />
                <path fill="#FBBC05" d="M6.5 14a6 6 0 0 1 0-4V7.4H3.2a10 10 0 0 0 0 9.2L6.5 14Z" />
                <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.7 9.7 0 0 0 3.2 7.4L6.5 10A5.8 5.8 0 0 1 12 6Z" />
              </svg>
              {googleLoading ? 'Connecting to Google...' : 'Continue with Google'}
            </button>
            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs uppercase tracking-wide text-gray-400">or</span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>
          </>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              {...register('email')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="you@example.com"
            />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              {...register('password')}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="••••••••"
            />
            {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">
          No account?{' '}
          <Link href={registerHref} className="text-indigo-600 hover:underline font-medium">Create one</Link>
        </p>

      </div>
    </div>
  )
}
