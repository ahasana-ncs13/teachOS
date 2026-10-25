import { useCallback, useEffect, useState } from 'react'
import { FiBell, FiCheck, FiExternalLink } from 'react-icons/fi'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import '../styles/notifications.css'

const notificationDate = (value) => new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
}).format(new Date(value))

export default function NotificationCenter() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get('/notifications')
      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
      setError('')
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not load notifications.')
    }
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(refresh, 0)
    const timer = window.setInterval(refresh, 30000)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(timer)
    }
  }, [refresh])

  const markAllRead = async () => {
    try {
      await api.patch('/notifications/read-all')
      setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })))
      setUnreadCount(0)
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not mark notifications as read.')
    }
  }

  const openNotification = async (notification) => {
    if (!notification.readAt) {
      try {
        await api.patch(`/notifications/${encodeURIComponent(notification._id)}/read`)
        setNotifications((items) => items.map((item) => item._id === notification._id ? { ...item, readAt: new Date().toISOString() } : item))
        setUnreadCount((count) => Math.max(0, count - 1))
      } catch (requestError) {
        setError(requestError.response?.data?.message || 'Could not update this notification.')
        return
      }
    }
    setOpen(false)
    if (typeof notification.href === 'string' && notification.href.startsWith('/')) navigate(notification.href)
  }

  return <div className="notification-center">
    <button className="notification-trigger" type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ''}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <FiBell />
      {unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {open && <section className="notification-popover" aria-label="Notifications">
      <header><div><strong>Notifications</strong><span>{unreadCount ? `${unreadCount} unread` : 'You are all caught up'}</span></div><button type="button" disabled={!unreadCount} onClick={markAllRead}><FiCheck /> Mark all read</button></header>
      {error && <p className="notification-error" role="alert">{error}</p>}
      <div className="notification-list">
        {notifications.length ? notifications.map((notification) => <button className={`notification-item${notification.readAt ? '' : ' unread'}`} key={notification._id} type="button" onClick={() => openNotification(notification)}>
          <span className="notification-dot" />
          <span className="notification-copy"><strong>{notification.title}</strong><span>{notification.message}</span><time>{notificationDate(notification.createdAt)}</time></span>
          <FiExternalLink className="notification-open-icon" />
        </button>) : !error ? <p className="notification-empty">Role-specific updates will appear here.</p> : null}
      </div>
    </section>}
  </div>
}
