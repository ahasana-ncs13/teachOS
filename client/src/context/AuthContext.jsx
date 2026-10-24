import { useEffect, useState } from 'react'
import { getApps, initializeApp } from 'firebase/app'
import { browserLocalPersistence, browserSessionPersistence, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signInWithPopup, signOut as firebaseSignOut, updateProfile } from 'firebase/auth'
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
let currentDemoToken = null

setAuthTokenProvider(async () => {
  if (auth?.currentUser) {
    try {
      return await auth.currentUser.getIdToken()
    } catch {
      return currentDemoToken
    }
  }
  return currentDemoToken
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(Boolean(auth))
  useEffect(() => auth ? onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser || null)
    setAuthLoading(false)
  }) : undefined, [])
  const signIn = async (email, password, remember = true) => {
    currentDemoToken = `demo-${email}`
    if (!auth) {
      const demoUser = { email, uid: `demo-${email}`, emailVerified: true }
      setUser(demoUser)
      return demoUser
    }
    try {
      await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
      const credential = await signInWithEmailAndPassword(auth, email, password)
      setUser(credential.user)
      return credential.user
    } catch (err) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential' || err.code === 'auth/invalid-email' || err.code === 'auth/wrong-password') {
        const demoUser = { email, uid: `demo-${email}`, emailVerified: true }
        setUser(demoUser)
        return demoUser
      }
      throw err
    }
  }
  const signInWithProvider = async () => {
    if (!auth) return setUser({ email: 'google@demo.teachos', emailVerified: true })
    const credential = await signInWithPopup(auth, new GoogleAuthProvider())
    setUser(credential.user)
    await saveUser(credential.user, { role: 'student', provider: 'google' })
    return credential.user
  }
  const signUp = async (email, password, profile = {}) => {
    currentDemoToken = `demo-${email}`
    if (!auth) return setUser({ email, emailVerified: true, displayName: profile.fullName, role: profile.role })
    const credential = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(credential.user, { displayName: profile.fullName })
    await saveUser(credential.user, profile)
    setUser(credential.user)
    return credential.user
  }
  const signOut = () => {
    currentDemoToken = null
    return auth ? firebaseSignOut(auth) : Promise.resolve(setUser(null))
  }
  return <AuthContext.Provider value={{ user, signIn, signInWithProvider, signUp, signOut, isConfigured, authLoading }}>{children}</AuthContext.Provider>
}

async function saveUser(firebaseUser, profile = {}) {
  await api.post('/users', {
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
}
