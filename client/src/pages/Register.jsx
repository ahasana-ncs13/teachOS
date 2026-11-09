import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FiArrowLeft, FiBookOpen, FiEye, FiEyeOff, FiLock, FiMail, FiUser } from 'react-icons/fi'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import '../styles/register.css'

const roles = [
  { value: 'teacher', label: 'Teacher', icon: FiBookOpen },
  { value: 'student', label: 'Student', icon: FiUser },
]

export default function Register() {
  const { signUp, isConfigured } = useAuth()
  const navigate = useNavigate()
  const [submitError, setSubmitError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: { role: 'teacher' } })

  const onSubmit = async ({ fullName, email, password, role }) => {
    setSubmitError('')
    try {
      await signUp(email, password, { fullName, role })
      navigate(role === 'teacher' ? '/dashboard' : '/student', { replace: true })
    } catch (error) {
      setSubmitError(error.code === 'auth/email-already-in-use' ? 'An account already exists for this email.' : error.code === 'auth/weak-password' ? 'Use a stronger password with at least 8 characters.' : error.code === 'ERR_NETWORK' ? 'The TeachOS server is not running. Start it with npm run dev, then try again.' : error.response?.data?.message || 'We could not create your account. Check your details and try again.')
    }
  }

  return (
    <main className="register-page signin-page">
      <section className="register-card signin-panel" aria-labelledby="register-title">
        <div className="register-form-wrap">
          <div className="register-header">
            <Brand />
            <h1 id="register-title">Create an account</h1>
            <p>Join TeachOS and start managing your educational journey.</p>
          </div>
          <form className="register-form" onSubmit={handleSubmit(onSubmit)}>
            <label>
              Full name
              <div className="register-input"><FiUser /><input placeholder="Jane Doe" {...register('fullName', { required: 'Full name is required' })} /></div>
              {errors.fullName && <span className="error">{errors.fullName.message}</span>}
            </label>
            <label>
              Email address
              <div className="register-input"><FiMail /><input type="email" placeholder="jane@school.edu" {...register('email', { required: 'Email is required' })} /></div>
              {errors.email && <span className="error">{errors.email.message}</span>}
            </label>
            <fieldset>
              <legend>Select your role</legend>
              <div className="role-grid">
                {roles.map(({ value, label, icon: Icon }) => (
                  <label className="role-option" key={value}>
                    <input type="radio" value={value} {...register('role', { required: true })} />
                    <span><Icon /><b>{label}</b></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              Password
              <div className="register-input password-register-input">
                <FiLock />
                <input type={showPassword ? 'text' : 'password'} placeholder="At least 8 characters" {...register('password', { required: 'Password is required', minLength: { value: 8, message: 'Password must be at least 8 characters' } })} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <FiEyeOff /> : <FiEye />}</button>
              </div>
              <small className="password-hint">Must be at least 8 characters.</small>
              {errors.password && <span className="error">{errors.password.message}</span>}
            </label>
            <label className="terms">
              <input type="checkbox" {...register('terms', { required: 'You must accept the terms' })} />
              <span>I agree to the <Link to="/terms-of-service">Terms of Service</Link> and <Link to="/privacy-policy">Privacy Policy</Link>.</span>
            </label>
            {errors.terms && <span className="error">{errors.terms.message}</span>}
            {submitError && <span className="error">{submitError}</span>}
            <button className="register-submit" disabled={isSubmitting || !isConfigured}>{isSubmitting ? 'Creating account...' : 'Create account'}</button>
            <p className="register-login">Already have an account? <Link to="/login">Log in here</Link></p>
          </form>
          {!isConfigured && <p className="demo-note register-config-note" role="status">Account creation is unavailable until Firebase is configured in <code>client/.env</code>.</p>}
          <Link className="register-back" to="/"><FiArrowLeft /> Back to TeachOS</Link>
        </div>
      </section>
      <section className="signin-showcase register-showcase" aria-label="TeachOS features">
        <div className="register-showcase-grid" />
        <div className="register-showcase-content">
          <header className="register-showcase-intro">
            <span className="register-showcase-kicker"><i /> TeachOS learning platform</span>
            <h2>One platform.<br /><em>Connected learning.</em></h2>
            <p>Bring online teaching, learning, and course management together in one workspace.</p>
            <div className="register-showcase-chips"><span>Course management</span><span>Online classes</span><span>Attendance records</span></div>
          </header>
        </div>
      </section>
    </main>
  )
}

function Brand() {
  return <Link className="register-brand" to="/"><span className="register-mark">T</span><strong>Teach<span>OS</span></strong></Link>
}
