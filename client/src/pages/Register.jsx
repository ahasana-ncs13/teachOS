import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FiArrowLeft, FiBookOpen, FiEye, FiEyeOff, FiLock, FiMail, FiShield, FiUser } from 'react-icons/fi'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/useAuth'
import '../styles/register.css'

const roles = [
  { value: 'admin', label: 'Admin', icon: FiShield },
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
      navigate('/dashboard', { replace: true })
    } catch (error) {
      setSubmitError(error.code === 'auth/email-already-in-use' ? 'An account already exists for this email.' : error.code === 'auth/weak-password' ? 'Use a stronger password with at least 8 characters.' : error.code === 'ERR_NETWORK' ? 'The TeachOS server is not running. Start it with npm run dev, then try again.' : error.response?.data?.message || 'We could not create your account. Check your details and try again.')
    }
  }

  return <main className="register-page"><section className="register-card"><div className="register-header"><Brand /><h1>Create an account</h1><p>Join TeachOS and start managing your educational journey.</p></div><form className="register-form" onSubmit={handleSubmit(onSubmit)}><label>Full name<div className="register-input"><FiUser /><input placeholder="Jane Doe" {...register('fullName', { required: 'Full name is required' })} /></div>{errors.fullName && <span className="error">{errors.fullName.message}</span>}</label><label>Email address<div className="register-input"><FiMail /><input type="email" placeholder="jane@school.edu" {...register('email', { required: 'Email is required' })} /></div>{errors.email && <span className="error">{errors.email.message}</span>}</label><fieldset><legend>Select your role</legend><div className="role-grid">{roles.map(({ value, label, icon: Icon }) => <label className="role-option" key={value}><input type="radio" value={value} {...register('role', { required: true })} /><span><Icon /><b>{label}</b></span></label>)}</div></fieldset><label>Password<div className="register-input password-register-input"><FiLock /><input type={showPassword ? 'text' : 'password'} placeholder="At least 8 characters" {...register('password', { required: 'Password is required', minLength: { value: 8, message: 'Password must be at least 8 characters' } })} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <FiEyeOff /> : <FiEye />}</button></div><small className="password-hint">Must be at least 8 characters.</small>{errors.password && <span className="error">{errors.password.message}</span>}</label><label className="terms"><input type="checkbox" {...register('terms', { required: 'You must accept the terms' })} /><span>I agree to the <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>.</span></label>{errors.terms && <span className="error">{errors.terms.message}</span>}{submitError && <span className="error">{submitError}</span>}<button className="register-submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account...' : 'Create account'}</button><p className="register-login">Already have an account? <Link to="/login">Log in here</Link></p></form>{!isConfigured && <p className="demo-note">Demo mode is active. Firebase credentials are loaded from your local environment.</p>}<Link className="register-back" to="/"><FiArrowLeft /> Back to TeachOS</Link></section></main>
}

function Brand() { return <Link className="register-brand" to="/"><span className="register-mark">T</span><strong>Teach<span>OS</span></strong></Link> }
