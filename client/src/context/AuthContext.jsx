import { useEffect, useState } from 'react'
import { getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, onAuthStateChanged, sendPasswordResetEmail, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut as firebaseSignOut, updateProfile } from 'firebase/auth'
import { AuthContext } from './authContext.js'
import { api, setAuthTokenProvider } from '../lib/api.js'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
const isConfigured = Object.values(firebaseConfig).every(Boolean)
const auth = isConfigured ? getAuth(getApps().length ? getApps()[0] : initializeApp(firebaseConfig)) : null

function authenticationConfigurationError() {
  const error = new Error('Firebase Authentication is not configured. Set the VITE_FIREBASE_* values in client/.env.')
  error.code = 'auth/configuration-not-found'
  return error
}

setAuthTokenProvider(
  // Normal: returns cached token (Firebase auto-refreshes when close to expiry)
  async () => {
    if (!auth?.currentUser) return null
    return auth.currentUser.getIdToken()
  },
  // Force-refresh: called by the 401 retry interceptor
  async () => {
    if (!auth?.currentUser) return null
    return auth.currentUser.getIdToken(true)
  },
)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(Boolean(auth))
  useEffect(() => auth ? onAuthStateChanged(auth, async (nextUser) => {
    if (!nextUser) {
      setUser(null)
      setAuthLoading(false)
      return
    }
    try {
      setUser(await loadUserProfile(nextUser))
    } catch {
      setUser(null)
    } finally {
      setAuthLoading(false)
    }
  }) : undefined, [])
  const signIn = async (email, password, remember = true) => {
    if (!auth) throw authenticationConfigurationError()
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
    const credential = await signInWithEmailAndPassword(auth, email, password)
    const signedInUser = await loadUserProfile(credential.user)
    setUser(signedInUser)
    return signedInUser
  }
  const signInWithProvider = async () => {
    if (!auth) throw authenticationConfigurationError()
    const credential = await signInWithPopup(auth, new GoogleAuthProvider())
    const profile = await saveUser(credential.user, { role: 'student', provider: 'google' })
    const signedInUser = { ...credential.user, ...profile }
    setUser(signedInUser)
    return signedInUser
  }
  const sendPasswordReset = async (email) => {
    if (!auth) throw authenticationConfigurationError()
    await sendPasswordResetEmail(auth, email)
  }
  const signUp = async (email, password, profile = {}) => {
    if (!auth) throw authenticationConfigurationError()
    const credential = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(credential.user, { displayName: profile.fullName })
    const savedProfile = await saveUser(credential.user, profile)
    const signedInUser = { ...credential.user, ...savedProfile }
    setUser(signedInUser)
    return signedInUser
  }
  const signOut = () => {
    return auth ? firebaseSignOut(auth) : Promise.resolve(setUser(null))
  }
  return <AuthContext.Provider value={{ user, signIn, signInWithProvider, sendPasswordReset, signUp, signOut, isConfigured, authLoading }}>{children}</AuthContext.Provider>
}

async function saveUser(firebaseUser, profile = {}) {
  const { data } = await api.post('/users', {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    photoURL: firebaseUser.photoURL,
    emailVerified: firebaseUser.emailVerified,
    provider: profile.provider || firebaseUser.providerData?.[0]?.providerId || 'password',
    role: profile.role || 'student',
    fullName: profile.fullName || firebaseUser.displayName,
    metadata: {
      createdAt: firebaseUser.metadata?.creationTime,
      lastLoginAt: firebaseUser.metadata?.lastSignInTime,
    },
  })
  return data.user
}

async function loadUserProfile(firebaseUser) {
  const { data } = await api.get('/users/me')
  return { ...firebaseUser, ...data.user }
}
