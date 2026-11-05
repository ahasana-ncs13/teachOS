import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { FiArrowLeft, FiBookOpen, FiCalendar, FiCheck, FiEye, FiEyeOff, FiLock, FiMail, FiUser, FiUsers } from 'react-icons/fi'
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
            <button className="register-submit" disabled={isSubmitting}>{isSubmitting ? 'Creating account...' : 'Create account'}</button>
            <p className="register-login">Already have an account? <Link to="/login">Log in here</Link></p>
          </form>
          {!isConfigured && <p className="demo-note">Demo mode is active. Firebase credentials are loaded from your local environment.</p>}
          <Link className="register-back" to="/"><FiArrowLeft /> Back to TeachOS</Link>
        </div>
      </section>
      <SignupShowcase />
    </main>
  )
}

function Brand() {
  return <Link className="register-brand" to="/"><span className="register-mark">T</span><strong>Teach<span>OS</span></strong></Link>
}

function SignupShowcase() {
  return <section className="signin-showcase register-showcase" aria-label="TeachOS learning ecosystem preview">
    <div className="register-showcase-grid" /><div className="register-showcase-aura register-showcase-aura-one" /><div className="register-showcase-aura register-showcase-aura-two" /><div className="register-showcase-aura register-showcase-aura-three" />
    <div className="register-showcase-content">
      <header className="register-showcase-intro"><span className="register-showcase-kicker"><i /> Next-Gen Education Ecosystem</span><h2>One platform. <em>Endless possibilities.</em></h2><p>Bring teaching, learning, and classroom management together. Everything you need to build a better learning experience.</p><div className="register-showcase-chips"><span>ϟ Smarter Classrooms</span><span><FiUsers /> Connected Learning</span><span><FiCheck /> Effortless Management</span></div></header>
      <div className="register-course-preview">
        <div className="register-float-card register-new-student"><span className="register-avatar">SJ<i /></span><div><strong>New student joined <small>• 3m ago</small></strong><span>Sarah Jenkins enrolled in Advanced Mathematics</span></div></div>
        <div className="register-float-card register-submission"><span className="register-float-icon"><FiCheck /></span><div><strong>Assignment submitted</strong><span>Calculus Problem Set 4 <b>Graded A+</b></span></div></div>
        <article className="register-course-card"><header><div><span>Mathematics Faculty</span><h3>Advanced Mathematics</h3></div><b><i /> Live Class</b></header><div className="register-instructor"><div><span className="register-avatar instructor-avatar">AV</span><p><strong>Dr. Alex Vance</strong><small>Lead Instructor</small></p></div><span className="register-student-stack"><i>EK</i><i>LM</i><i>RT</i><i>JN</i> +38 students in session</span></div><div className="register-progress"><div><span>Course Progress</span><b>74% Syllabus Completed</b></div><i><em /></i></div><div className="register-course-lessons"><CourseLesson done title="01. Multivariable Calculus & Vectors" label="Completed" /><CourseLesson active title="02. Differential Equations & Dynamics" label="In progress · 42 mins" /><CourseLesson title="03. Linear Algebra & Matrix Transformations" label="Next lesson" /></div></article>
        <div className="register-float-card register-progress-card"><span className="register-progress-ring">78%</span><div><strong>Course progress</strong><span>Weekly milestone on track</span></div></div><div className="register-float-card register-upcoming"><span className="register-float-icon"><FiCalendar /></span><div><strong>Upcoming class</strong><span>Today · 4:30 PM · Room 4B / Live Stream</span></div></div>
      </div>
    </div>
  </section>
}

function CourseLesson({ title, label, done, active }) {
  return <div className={`register-course-lesson${active ? ' is-active' : ''}`}><span><i>{done ? <FiCheck /> : active ? '▶' : '⌑'}</i>{title}</span><b>{label}</b></div>
}
