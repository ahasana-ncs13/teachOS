import { useState } from 'react'
import { FiCheck, FiCloud, FiSave, FiSettings, FiUpload } from 'react-icons/fi'
import AdminLayout from './AdminLayout'
import '../../styles/admin-settings.css'

const STORAGE_KEY = 'teachos-admin-branding'
const MAX_LOGO_BYTES = 2 * 1024 * 1024
const colors = [
  { label: 'Blue', value: '#2563eb' },
  { label: 'Purple', value: '#7c3aed' },
  { label: 'Teal', value: '#0f766e' },
  { label: 'Rose', value: '#be123c' },
]
const defaultSettings = {
  logo: '',
  primaryColor: '#2a14b4',
  headingFont: 'Inter',
  bodyFont: 'Inter',
  studentDarkMode: true,
  hideWatermark: false,
}
const fontOptions = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Nunito', 'Playfair Display', 'Merriweather']
const settingsSections = [
  { label: 'Profile', ready: false },
  { label: 'Academy', ready: false },
  { label: 'Payment', ready: false },
  { label: 'Notifications', ready: false },
  { label: 'Security', ready: false },
  { label: 'Staff', ready: false },
  { label: 'Subscription', ready: false },
  { label: 'Branding', ready: true },
]

function readSettings() {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (!saved) return defaultSettings
  const parsed = JSON.parse(saved)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Saved settings have an invalid format.')
  return {
    ...defaultSettings,
    headingFont: ['Inter', 'Roboto', 'Playfair Display', 'Merriweather'].includes(parsed.headingFont) ? parsed.headingFont : defaultSettings.headingFont,
    bodyFont: fontOptions.includes(parsed.bodyFont) ? parsed.bodyFont : defaultSettings.bodyFont,
    primaryColor: /^#[0-9a-f]{6}$/i.test(parsed.primaryColor) ? parsed.primaryColor : defaultSettings.primaryColor,
    logo: typeof parsed.logo === 'string' && parsed.logo.startsWith('data:image/') ? parsed.logo : '',
    studentDarkMode: typeof parsed.studentDarkMode === 'boolean' ? parsed.studentDarkMode : defaultSettings.studentDarkMode,
    hideWatermark: typeof parsed.hideWatermark === 'boolean' ? parsed.hideWatermark : defaultSettings.hideWatermark,
  }
}

function loadInitialSettings() {
  try {
    return { settings: readSettings(), error: '' }
  } catch (loadError) {
    return { settings: defaultSettings, error: `Could not load saved branding settings: ${loadError.message}` }
  }
}

export default function AdminSettings() {
  const [initial] = useState(loadInitialSettings)
  const [settings, setSettings] = useState(initial.settings)
  const [savedSettings, setSavedSettings] = useState(initial.settings)
  const [hexDraft, setHexDraft] = useState(initial.settings.primaryColor.slice(1).toUpperCase())
  const [error, setError] = useState(initial.error)
  const [notice, setNotice] = useState('')

  const update = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }))
    if (key === 'primaryColor') setHexDraft(value.slice(1).toUpperCase())
    setNotice('')
  }

  const uploadLogo = (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    setNotice('')
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'].includes(file.type)) {
      setError('Choose a PNG, JPG, GIF, SVG, or WebP image.')
      event.target.value = ''
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('The logo must be 2 MB or smaller.')
      event.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') update('logo', reader.result)
      else setError('The selected image could not be read.')
    }
    reader.onerror = () => setError('The selected image could not be read.')
    reader.readAsDataURL(file)
  }

  const save = (event) => {
    event.preventDefault()
    setError('')
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
      setSavedSettings(settings)
      setHexDraft(settings.primaryColor.slice(1).toUpperCase())
      setNotice('Branding settings saved in this browser.')
    } catch (saveError) {
      setError(`Could not save branding settings in this browser: ${saveError.message}`)
    }
  }

  const cancel = () => {
    setSettings(savedSettings)
    setHexDraft(savedSettings.primaryColor.slice(1).toUpperCase())
    setError('')
    setNotice('')
  }

  const previewStyle = {
    '--preview-brand': settings.primaryColor,
    '--preview-heading-font': `"${settings.headingFont}", sans-serif`,
    '--preview-body-font': `"${settings.bodyFont}", sans-serif`,
  }

  return <AdminLayout title="Settings" subtitle="Manage administrator preferences and platform branding">
    <div className="admin-settings" style={previewStyle}>
      <header className="settings-heading">
        <div><h2>Settings</h2><p>Manage your academy preferences and branding.</p></div>
      </header>

      {error && <p className="settings-feedback error" role="alert">{error}</p>}
      {notice && <p className="settings-feedback success" role="status"><FiCheck />{notice}</p>}

      <div className="settings-layout">
        <nav className="settings-section-nav" aria-label="Settings sections">
          {settingsSections.map(({ label, ready }) => ready
            ? <a key={label} className="settings-section-link active" href="#branding-settings" aria-current="page"><FiSettings />{label}</a>
            : <span key={label} className="settings-section-link unavailable" aria-disabled="true" title={`${label} settings are not available yet.`}><span className="settings-section-dot" />{label}<small>Soon</small></span>)}
        </nav>

        <form className="settings-canvas" onSubmit={save}>
          <section className="settings-card" id="branding-settings">
            <header className="settings-card-heading"><h3>Brand Identity</h3><p>Customize how your academy appears to students and staff across the platform.</p></header>

            <div className="settings-field-section">
              <h4>Academy Logo</h4>
              <div className="settings-logo-row">
                <div className="settings-logo-preview" aria-label="Academy logo preview">
                  {settings.logo ? <img src={settings.logo} alt="Academy logo preview" /> : <span>A</span>}
                </div>
                <label className="settings-upload">
                  <input type="file" accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp" aria-label="Upload academy logo" onChange={uploadLogo} />
                  <span className="settings-upload-icon"><FiUpload /></span>
                  <strong>Click to upload an academy logo</strong>
                  <small>SVG, PNG, JPG, GIF or WebP (max. 2 MB)</small>
                </label>
                {settings.logo && <button className="settings-remove-logo" type="button" onClick={() => update('logo', '')}>Remove logo</button>}
              </div>
            </div>

            <div className="settings-field-section">
              <h4>Primary Brand Color</h4>
              <div className="settings-color-row">
                {colors.map(({ label, value }) => <button key={value} className={`settings-color-swatch${settings.primaryColor.toLowerCase() === value ? ' selected' : ''}`} type="button" style={{ '--swatch-color': value }} aria-label={`Select ${label} color`} aria-pressed={settings.primaryColor.toLowerCase() === value} onClick={() => update('primaryColor', value)}>{settings.primaryColor.toLowerCase() === value && <FiCheck />}</button>)}
                <label className="settings-color-picker" aria-label="Choose custom brand color"><FiCloud /><input aria-label="Custom brand color" type="color" value={settings.primaryColor} onChange={(event) => update('primaryColor', event.target.value)} /></label>
                <label className="settings-hex-field"><span>#</span><input aria-label="Hex color code" value={hexDraft} maxLength={6} onChange={(event) => {
                  const hex = event.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6)
                  setHexDraft(hex.toUpperCase())
                  if (hex.length === 6) update('primaryColor', `#${hex}`)
                }} onBlur={() => {
                  if (hexDraft.length !== 6) setHexDraft(settings.primaryColor.slice(1).toUpperCase())
                }} /></label>
              </div>
              <small className="settings-help">Choose a preset or enter a six-digit HEX color.</small>
            </div>

            <div className="settings-field-section">
              <h4>Typography</h4>
              <div className="settings-font-grid">
                <label>Headings Font<select value={settings.headingFont} onChange={(event) => update('headingFont', event.target.value)}>{['Inter', 'Roboto', 'Playfair Display', 'Merriweather'].map((font) => <option key={font}>{font}</option>)}</select></label>
                <label>Body Font<select value={settings.bodyFont} onChange={(event) => update('bodyFont', event.target.value)}>{fontOptions.slice(0, 5).map((font) => <option key={font}>{font}</option>)}</select></label>
              </div>
              <div className="settings-preview">
                <span>Preview</span>
                <h4>Academy Course Portal</h4>
                <p>Welcome to our learning management system. This preview shows the selected heading and body fonts.</p>
                <button type="button">Primary Action</button>
              </div>
            </div>
          </section>

          <section className="settings-card settings-advanced">
            <header className="settings-card-heading"><h3>Advanced Preferences</h3><p>Student-facing options for your academy.</p></header>
            <label className="settings-toggle-row"><span><strong>Enable Dark Mode for Students</strong><small>Allow students to toggle between light and dark themes.</small></span><input type="checkbox" checked={settings.studentDarkMode} onChange={(event) => update('studentDarkMode', event.target.checked)} /></label>
            <label className="settings-toggle-row"><span><strong>Hide TeachOS Watermark</strong><small>Remove “Powered by TeachOS” from the student footer.</small></span><input type="checkbox" checked={settings.hideWatermark} onChange={(event) => update('hideWatermark', event.target.checked)} /></label>
            <p className="settings-local-note">These branding preferences are saved locally in this browser; they do not yet change student pages or other devices.</p>
          </section>

          <footer className="settings-actions">
            <button className="settings-cancel" type="button" onClick={cancel}>Cancel</button>
            <button className="settings-save" type="submit"><FiSave />Save Changes</button>
          </footer>
        </form>
      </div>
    </div>
  </AdminLayout>
}
