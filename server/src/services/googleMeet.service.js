import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { getDatabase } from '../db.js'
import { writeAuditLog } from './audit.service.js'

const STATE_COLLECTION = 'googleMeetOAuthStates'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const CALENDAR_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const OAUTH_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

function configuration() {
  const { GOOGLE_MEET_CLIENT_ID, GOOGLE_MEET_CLIENT_SECRET, GOOGLE_MEET_TOKEN_ENCRYPTION_KEY } = process.env
  const encryptionKey = GOOGLE_MEET_TOKEN_ENCRYPTION_KEY || ''
  const validEncryptionKey = /^[a-f\d]{64}$/i.test(encryptionKey)
  const port = process.env.PORT || 5000
  const redirectUri = process.env.GOOGLE_MEET_REDIRECT_URI || `http://localhost:${port}/api/course-management/google-meet/callback`
  const configured = Boolean(GOOGLE_MEET_CLIENT_ID && GOOGLE_MEET_CLIENT_SECRET && validEncryptionKey)

  return {
    clientId: GOOGLE_MEET_CLIENT_ID,
    clientSecret: GOOGLE_MEET_CLIENT_SECRET,
    encryptionKey: validEncryptionKey ? Buffer.from(encryptionKey, 'hex') : null,
    redirectUri,
    configured,
    message: configured
      ? 'Connect your Google account to schedule Meet sessions from TeachOS.'
      : 'Set GOOGLE_MEET_CLIENT_ID, GOOGLE_MEET_CLIENT_SECRET, and a 64-character hexadecimal GOOGLE_MEET_TOKEN_ENCRYPTION_KEY in server/.env.',
  }
}

function serviceError(message, status, code) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function encryptToken(token, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    value: encrypted.toString('base64'),
  }
}

function decryptToken(encryptedToken, key) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(encryptedToken.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(encryptedToken.tag, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedToken.value, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw serviceError('Google Meet connection could not be unlocked. Reconnect your Google account.', 409, 'GOOGLE_MEET_RECONNECT_REQUIRED')
  }
}

async function responseJson(response, message) {
  let result
  try {
    result = await response.json()
  } catch {
    result = null
  }
  if (!response.ok) {
    const error = serviceError(
      typeof result?.error_description === 'string'
        ? result.error_description
        : typeof result?.error?.message === 'string'
          ? result.error.message
          : message,
      response.status === 401 ? 401 : 502,
      response.status === 401 ? 'GOOGLE_MEET_REAUTH_REQUIRED' : 'GOOGLE_MEET_REQUEST_FAILED',
    )
    throw error
  }
  return result
}

export function getGoogleMeetConfiguration() {
  const settings = configuration()
  return {
    configured: settings.configured,
    redirectUri: settings.redirectUri,
    message: settings.message,
  }
}

export async function createGoogleAuthorizationUrl({ uid, role, listingId }) {
  const settings = configuration()
  if (!settings.configured) {
    throw serviceError(settings.message, 503, 'GOOGLE_MEET_NOT_CONFIGURED')
  }

  const state = randomBytes(32).toString('base64url')
  const now = new Date()
  await getDatabase().collection(STATE_COLLECTION).insertOne({
    _id: state,
    teacherUid: uid,
    actorRole: role,
    listingId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
  })

  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authorizationUrl.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  }).toString()
  return authorizationUrl.toString()
}

function courseReturnUrl(listingId, result) {
  const frontendOrigin = (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim()
  const destination = listingId
    ? new URL(`/dashboard/course/${encodeURIComponent(listingId)}`, frontendOrigin)
    : new URL('/dashboard/teaching-studio', frontendOrigin)
  destination.searchParams.set('tab', 'live')
  destination.searchParams.set('googleMeet', result)
  return destination.toString()
}

export async function completeGoogleAuthorization({ code, state, oauthError }) {
  if (typeof state !== 'string' || state.length < 32 || state.length > 128) {
    throw serviceError('Google authorization state is missing or invalid.', 400, 'INVALID_GOOGLE_OAUTH_STATE')
  }

  const states = getDatabase().collection(STATE_COLLECTION)
  const authorizationState = await states.findOneAndDelete({ _id: state, expiresAt: { $gt: new Date() } })
  if (!authorizationState) {
    throw serviceError('Google authorization expired. Please reconnect and try again.', 400, 'GOOGLE_OAUTH_STATE_EXPIRED')
  }

  if (oauthError || typeof code !== 'string' || !code) {
    return courseReturnUrl(authorizationState.listingId, 'cancelled')
  }

  const settings = configuration()
  if (!settings.configured) {
    return courseReturnUrl(authorizationState.listingId, 'error')
  }

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      redirect_uri: settings.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = await responseJson(tokenResponse, 'Google could not complete account authorization.')
  if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) {
    throw serviceError('Google did not return a refresh token. Reconnect and approve access when prompted.', 502, 'GOOGLE_REFRESH_TOKEN_MISSING')
  }

  const updatedUser = await getDatabase().collection('users').updateOne(
    { uid: authorizationState.teacherUid, role: { $in: ['teacher', 'admin', 'superAdmin'] } },
    {
      $set: {
        googleMeet: {
          refreshToken: encryptToken(tokens.refresh_token, settings.encryptionKey),
          connectedAt: new Date(),
        },
      },
    },
  )
  if (!updatedUser.matchedCount) {
    throw serviceError('TeachOS account was not found. Sign in again before connecting Google.', 404, 'TEACHER_ACCOUNT_NOT_FOUND')
  }
  await writeAuditLog({
    actorUid: authorizationState.teacherUid,
    actorRole: authorizationState.actorRole,
    action: 'CONNECT_GOOGLE_MEET',
    targetType: 'teacherGoogleAccount',
    meta: { provider: 'google-calendar' },
  })
  return courseReturnUrl(authorizationState.listingId, 'connected')
}

export async function disconnectGoogleAccount({ uid, role }) {
  await getDatabase().collection('users').updateOne(
    { uid },
    { $unset: { googleMeet: '' } },
  )
  await writeAuditLog({
    actorUid: uid,
    actorRole: role,
    action: 'DISCONNECT_GOOGLE_MEET',
    targetType: 'teacherGoogleAccount',
    meta: { provider: 'google-calendar' },
  })
}

async function accessTokenFor(uid) {
  const settings = configuration()
  if (!settings.configured) {
    throw serviceError(settings.message, 503, 'GOOGLE_MEET_NOT_CONFIGURED')
  }
  const user = await getDatabase().collection('users').findOne(
    { uid },
    { projection: { 'googleMeet.refreshToken': 1 } },
  )
  const encryptedRefreshToken = user?.googleMeet?.refreshToken
  if (!encryptedRefreshToken) {
    throw serviceError('Connect your Google account before creating a Meet link.', 409, 'GOOGLE_MEET_NOT_CONNECTED')
  }

  const tokenResponse = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      refresh_token: decryptToken(encryptedRefreshToken, settings.encryptionKey),
      grant_type: 'refresh_token',
    }),
  })
  const tokens = await responseJson(tokenResponse, 'Could not refresh Google authorization. Reconnect your Google account.')
  if (typeof tokens.access_token !== 'string' || !tokens.access_token) {
    throw serviceError('Google did not return an access token. Reconnect your Google account.', 502, 'GOOGLE_ACCESS_TOKEN_MISSING')
  }
  return tokens.access_token
}

export async function createGoogleMeetEvent({ uid, title, scheduledAt }) {
  if (!(scheduledAt instanceof Date) || Number.isNaN(scheduledAt.getTime())) {
    throw serviceError('Choose a valid date and time before creating a Google Meet.', 400, 'MEET_SCHEDULE_REQUIRED')
  }
  const accessToken = await accessTokenFor(uid)
  const endTime = new Date(scheduledAt.getTime() + 60 * 60 * 1000)
  const eventResponse = await fetch(`${CALENDAR_EVENTS_URL}?conferenceDataVersion=1`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      summary: title,
      start: { dateTime: scheduledAt.toISOString(), timeZone: 'Asia/Dhaka' },
      end: { dateTime: endTime.toISOString(), timeZone: 'Asia/Dhaka' },
      conferenceData: {
        createRequest: {
          requestId: randomUUID(),
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    }),
  })
  const event = await responseJson(eventResponse, 'Google Calendar could not create the Meet event.')
  let meetLink = event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri
  if (!meetLink && typeof event.id === 'string') {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (event.conferenceData?.createRequest?.status?.statusCode === 'failure') break
      await new Promise((resolve) => setTimeout(resolve, 500))
      const currentResponse = await fetch(`${CALENDAR_EVENTS_URL}/${encodeURIComponent(event.id)}?conferenceDataVersion=1`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const currentEvent = await responseJson(currentResponse, 'Google Calendar could not confirm the Meet link.')
      meetLink = currentEvent.hangoutLink || currentEvent.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === 'video')?.uri
      if (meetLink) break
    }
  }
  if (!meetLink || typeof event.id !== 'string') {
    if (typeof event.id === 'string') {
      await deleteGoogleCalendarEvent({ uid, eventId: event.id })
    }
    throw serviceError('Google Calendar created an event but did not return a Meet link. Check that Meet is enabled for this account.', 502, 'GOOGLE_MEET_LINK_MISSING')
  }
  return { eventId: event.id, meetLink }
}

export async function deleteGoogleCalendarEvent({ uid, eventId }) {
  const accessToken = await accessTokenFor(uid)
  const response = await fetch(`${CALENDAR_EVENTS_URL}/${encodeURIComponent(eventId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (response.status === 404 || response.status === 410 || response.ok) return
  await responseJson(response, 'Google Calendar could not remove the Meet event.')
}
