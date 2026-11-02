import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FiArrowRight, FiBookOpen, FiCheck, FiEye, FiEyeOff, FiLock, FiTrendingUp, FiUser, FiUserPlus } from 'react-icons/fi'
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
  const [socialLoading, setSocialLoading] = useState(false)
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm({ defaultValues: { remember: true } })

  const onSubmit = async ({ email, password, remember }) => {
    setSubmitError('')
    setResetNotice('')
    try {
      const signedInUser = await signIn(email, password, remember)
      navigate(getRoleHome(signedInUser.role), { replace: true })
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

  const signInWithGoogle = async () => {
    setSubmitError('')
    setSocialLoading(true)
    try {
      const signedInUser = await signInWithProvider('Google')
      navigate(getRoleHome(signedInUser.role), { replace: true })
    } catch (error) {
      setSubmitError(error.code === 'auth/popup-closed-by-user'
        ? 'Google sign-in was cancelled.'
        : 'Google sign-in is unavailable. Enable this provider in Firebase Authentication.')
    } finally {
      setSocialLoading(false)
    }
  }

  return (
    <main className="signin-page">
      <section className="signin-panel" aria-labelledby="signin-title">
        <div className="signin-form-wrap">
          <Link className="signin-brand" to="/" aria-label="TeachOS home">
            <span className="signin-mark"><FiBookOpen aria-hidden="true" /></span>
            <strong>TeachOS</strong>
          </Link>

          <div className="signin-heading">
            <h1 id="signin-title">Welcome back.</h1>
            <p>One platform to manage your courses, students and learning.</p>
          </div>

          {!isConfigured && (
            <div className="config-note" role="status">
              Demo mode is active. Configure Firebase in <code>client/.env</code> for real authentication.
            </div>
          )}

          <form className="signin-form" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className={`signin-field${errors.email ? ' is-invalid' : ''}`}>
              <FiUser className="signin-field-icon" aria-hidden="true" />
              <input
                id="signin-email"
                type="email"
                placeholder=" "
                autoComplete="username"
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'signin-email-error' : undefined}
                {...register('email', {
                  required: 'Email address is required',
                  pattern: { value: /^\S+@\S+\.\S+$/, message: 'Enter a valid email address' },
                })}
              />
              <label htmlFor="signin-email">Email address</label>
              {errors.email && <span className="signin-error" id="signin-email-error">{errors.email.message}</span>}
            </div>

            <div className={`signin-field${errors.password ? ' is-invalid' : ''}`}>
              <FiLock className="signin-field-icon" aria-hidden="true" />
              <input
                id="signin-password"
                type={showPassword ? 'text' : 'password'}
                placeholder=" "
                autoComplete="current-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'signin-password-error' : undefined}
                {...register('password', { required: 'Password is required' })}
              />
              <label htmlFor="signin-password">Password</label>
              <button
                className="signin-password-toggle"
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <FiEyeOff /> : <FiEye />}
              </button>
              {errors.password && <span className="signin-error" id="signin-password-error">{errors.password.message}</span>}
            </div>

            <div className="signin-options">
              <label className="signin-remember">
                <input type="checkbox" {...register('remember')} />
                <span>Keep me signed in</span>
              </label>
              <button className="forgot-password" type="button" onClick={requestPasswordReset} disabled={resetSending}>
                {resetSending ? 'Sending link...' : 'Forgot password?'}
              </button>
            </div>

            {submitError && <p className="signin-feedback signin-error" role="alert">{submitError}</p>}
            {resetNotice && <p className="signin-feedback signin-notice" role="status">{resetNotice}</p>}

            <button className="signin-submit" type="submit" disabled={isSubmitting || resetSending}>
              {isSubmitting
                ? <><span className="signin-spinner" aria-hidden="true" /> Signing in...</>
                : <>Sign in <FiArrowRight aria-hidden="true" /></>}
            </button>
          </form>

          <div className="signin-divider"><span>or</span></div>

          <button className="signin-google" type="button" onClick={signInWithGoogle} disabled={socialLoading || isSubmitting}>
            <GoogleIcon />
            {socialLoading ? 'Connecting to Google...' : 'Continue with Google'}
          </button>

          <p className="signin-register">
            New to TeachOS? <Link to="/register">Create an account</Link>
          </p>
        </div>
      </section>

      <section className="signin-showcase" aria-label="TeachOS workspace preview">
        <div className="showcase-orb showcase-orb-one" />
        <div className="showcase-orb showcase-orb-two" />
        <div className="showcase-orb showcase-orb-three" />
        <div className="showcase-grid" />
        <div className="showcase-content">
          <div className="showcase-intro">
            <h2>Teach more.<br />Manage less.</h2>
            <p>Courses, students, assignments and payouts, all in one calm workspace.</p>
          </div>
          <div className="showcase-visual">
            <div className="showcase-dashboard">
              <div className="showcase-dashboard-heading">
                <div>
                  <span className="showcase-eyebrow">Monthly earnings</span>
                  <strong>$4,820</strong>
                </div>
                <span className="showcase-live"><i /> Live</span>
              </div>
              <div className="showcase-chart" aria-label="Example monthly earnings chart">
                {[38, 52, 46, 68, 60, 88].map((height, index) => (
                  <span className={index === 5 ? 'showcase-bar is-highlighted' : 'showcase-bar'} style={{ '--bar-height': `${height}%`, '--bar-index': index }} key={height} />
                ))}
                <svg className="showcase-chart-line" viewBox="0 0 420 150" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M5 118 C45 110, 53 89, 88 95 S137 104, 170 76 S224 68, 253 82 S302 58, 335 46 S380 30, 415 12" />
                </svg>
              </div>
              <div className="showcase-stats">
                <div><span>Students</span><strong>1,284</strong></div>
                <div><span>Courses</span><strong>12</strong></div>
                <div><span>Rating</span><strong>4.9</strong></div>
              </div>
            </div>
            <div className="showcase-float showcase-engagement">
              <span className="showcase-float-icon"><FiTrendingUp /></span>
              <span><small>Engagement</small><strong>+24%</strong></span>
            </div>
            <div className="showcase-float showcase-graded">
              <span className="showcase-progress"><FiCheck /></span>
              <span><small>Assignments graded</small><strong>142 <small>/ 190</small></strong></span>
            </div>
            <div className="showcase-enrollment"><FiUserPlus /><span>New student enrolled</span></div>
          </div>
        </div>
        <p className="showcase-caption">A little more focus for the work that matters.</p>
      </section>
    </main>
  )
}

function getRoleHome(role) {
  return role === 'admin' ? '/admin' : role === 'teacher' ? '/dashboard' : '/student'
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

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  )
}
