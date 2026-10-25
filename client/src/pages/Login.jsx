import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FiArrowRight, FiEye, FiEyeOff } from 'react-icons/fi'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import '../styles/login.css'

export default function Login() {
  const navigate = useNavigate()
  const { signIn, signInWithProvider, sendPasswordReset, isConfigured } = useAuth()
  const [submitError, setSubmitError] = useState('')
  const [resetNotice, setResetNotice] = useState('')
  const [resetSending, setResetSending] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [socialLoading, setSocialLoading] = useState('')
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm({ defaultValues: { remember: true } })

  const onSubmit = async ({ email, password, remember }) => {
    setSubmitError('')
    setResetNotice('')
    try {
      const signedInUser = await signIn(email, password, remember)
      const target = signedInUser.role === 'admin' ? '/admin' : signedInUser.role === 'teacher' ? '/dashboard' : '/'
      navigate(target, { replace: true })
    } catch (error) {
      setSubmitError(getSignInErrorMessage(error))
    }
  }

  const requestPasswordReset = async () => {
    const email = getValues('email')?.trim()
    setSubmitError('')
    setResetNotice('')
    if (!email) {
      setSubmitError('Enter your email address first, then choose “Forgot password?”.')
      return
    }
    setResetSending(true)
    try {
      await sendPasswordReset(email)
      setResetNotice('If an account exists for that email, Firebase will send a password reset link shortly.')
    } catch (error) {
      setSubmitError(getSignInErrorMessage(error))
    } finally {
      setResetSending(false)
    }
  }

  const signInSocially = async (provider) => {
    setSubmitError('')
    setSocialLoading(provider)
    try {
      const signedInUser = await signInWithProvider(provider)
      navigate(signedInUser.role === 'admin' ? '/admin' : signedInUser.role === 'teacher' ? '/dashboard' : '/', { replace: true })
    } catch { setSubmitError(`${provider} sign-in is unavailable. Enable this provider in Firebase Authentication.`) } finally { setSocialLoading('') }
  }

  return <main className="signin-page"><section className="signin-panel"><div className="signin-form-wrap"><Link className="signin-brand" to="/"><span className="signin-mark">T</span><strong>Teach<span>OS</span></strong></Link><div className="signin-heading"><h1>Welcome back</h1><p>Sign in to your TeachOS account to continue.</p></div>{!isConfigured && <div className="config-note">Demo mode is active. Configure Firebase in `client/.env` for real authentication.</div>}<form className="signin-form" onSubmit={handleSubmit(onSubmit)}><label>Email address<input type="email" placeholder="name@school.edu" {...register('email', { required: 'Email address is required' })} />{errors.email && <span className="signin-error">{errors.email.message}</span>}</label><label><span className="password-label">Password <button className="forgot-password" type="button" onClick={requestPasswordReset} disabled={resetSending}>{resetSending ? 'Sending reset link...' : 'Forgot password?'}</button></span><span className="password-input"><input type={showPassword ? 'text' : 'password'} placeholder="••••••••" {...register('password', { required: 'Password is required' })} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <FiEyeOff /> : <FiEye />}</button></span>{errors.password && <span className="signin-error">{errors.password.message}</span>}</label><label className="remember"><input type="checkbox" {...register('remember')} /><span>Remember me</span></label>{submitError && <span className="signin-error" role="alert">{submitError}</span>}{resetNotice && <span className="signin-notice" role="status">{resetNotice}</span>}<button className="signin-submit" disabled={isSubmitting || resetSending}>{isSubmitting ? 'Signing in...' : <>Sign in <FiArrowRight /></>}</button></form><div className="signin-divider"><span>Or continue with</span></div><div className="social-grid"><button type="button" onClick={() => signInSocially('Google')} disabled={Boolean(socialLoading)}><GoogleIcon />{socialLoading === 'Google' ? 'Connecting...' : 'Google'}</button></div><p className="signin-register">Don't have an account? <Link to="/register">Create an account</Link></p></div></section><section className="signin-hero"><div className="signin-hero-image" /><div className="signin-quote"><p>"Empowering the next generation of educators."</p><span>— The TeachOS Mission</span></div></section></main>
}

function getSignInErrorMessage(error) {
  if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(error.code)) {
    return 'Email or password is incorrect. Check your details, or use “Forgot password?” to reset it.'
  }
  if (error.code === 'auth/too-many-requests') return 'Too many attempts. Wait a little before trying again.'
  if (error.code === 'auth/user-disabled') return 'This account has been disabled. Contact TeachOS support for help.'
  if (error.code === 'auth/operation-not-allowed') return 'Email/password sign-in is disabled. Enable Email/Password in Firebase Console → Authentication → Sign-in method.'
  if (error.code === 'auth/invalid-api-key' || error.code === 'auth/api-key-not-valid') return 'Firebase rejected the app API key. Check VITE_FIREBASE_API_KEY in client/.env and restart the client.'
  if (error.code === 'auth/unauthorized-domain') return 'This website domain is not authorized in Firebase. Add localhost under Firebase Authentication → Settings → Authorized domains.'
  if (error.code === 'auth/network-request-failed') return 'Could not reach Firebase Authentication. Check your internet connection and try again.'
  if (error.code === 'auth/demo-mode') return 'Password reset requires Firebase authentication. Configure Firebase in client/.env first.'
  if (error.code === 'ERR_NETWORK') return 'TeachOS could not reach its API. Check that the server is running and its CORS settings include this site.'
  return error.response?.data?.message || 'We could not complete sign-in. Check your details and Firebase Authentication settings.'
}

function GoogleIcon() { return <svg aria-hidden="true" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" /><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" /></svg> }
