function BellIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function HomeIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 10.5 9-7.5 9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9 21v-7h6v7" />
    </svg>
  )
}

function BookingIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="m8.5 15.5 2 2 5-5" />
    </svg>
  )
}

function formatNotificationDate(value, timeZone = 'Asia/Manila') {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-PH', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Navbar({
  currentPage,
  onNavigate,
  isSignedIn,
  isAdmin,
  user,
  showProfileReminder = false,
  notifications = [],
  notificationOpen = false,
  onToggleNotifications,
  onSelectNotification,
}) {
  const initials = user
    ? (user.displayName || user.email || 'U')
        .split(' ')
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '';
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  return (
    <nav className="navbar">
      <div className="brand-mark" onClick={() => onNavigate(isAdmin ? 'admin' : 'home')} style={{ cursor: 'pointer' }}>
        <div className="brand-monogram">
          <img
            src="/assets/ln-logo.jpg"
            alt="Luxe Nails by Piya"
            className="brand-img"
            width="46"
            height="46"
          />
        </div>
        <div className="brand-text">
          <h1>Luxe Nails</h1>
          <span>by Piya</span>
        </div>
      </div>

      <div className="nav-links">
        {!isAdmin && (
          <button
            type="button"
            className={`nav-icon-button ${currentPage === 'home' ? 'is-active' : ''}`}
            onClick={() => onNavigate('home')}
            aria-label="Home"
            title="Home"
          >
            <HomeIcon />
          </button>
        )}
        {!isAdmin && (
          <button
            type="button"
            className={`nav-icon-button ${currentPage === 'booking' ? 'is-active' : ''}`}
            onClick={() => onNavigate('booking')}
            aria-label="Book an appointment"
            title="Book an appointment"
          >
            <BookingIcon />
          </button>
        )}
        {isSignedIn && !isAdmin ? (
          <div className="nav-notification-wrap">
            <button
              type="button"
              className={`nav-notification-button ${notificationOpen ? 'is-active' : ''}`}
              onClick={onToggleNotifications}
              aria-label={unreadCount ? `${unreadCount} unread notifications` : 'Notifications'}
              aria-expanded={notificationOpen}
              title="Notifications"
            >
              <BellIcon />
              {unreadCount > 0 ? <span className="nav-notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
            </button>

            {notificationOpen ? (
              <section className="nav-notification-panel" aria-label="Notifications">
                <header className="nav-notification-header">
                  <div>
                    <strong>Notifications</strong>
                    <span>{notifications.length ? `${notifications.length} recent` : 'No updates yet'}</span>
                  </div>
                </header>
                <div className="nav-notification-list">
                  {notifications.length ? notifications.map((notification) => (
                    <button
                      type="button"
                      className={`nav-notification-item ${notification.read ? 'is-read' : 'is-unread'}`}
                      key={notification.id}
                      onClick={() => onSelectNotification?.(notification)}
                    >
                      <span className={`nav-notification-item-icon ${notification.type === 'appointment_reminder' ? 'is-reminder' : ''}`}>
                        {notification.type === 'appointment_reminder' ? <BellIcon size={15} /> : '\u2713'}
                      </span>
                      <span className="nav-notification-item-copy">
                        <strong>{notification.title || 'Booking confirmed'}</strong>
                        <span>{notification.message}</span>
                        <small>{formatNotificationDate(notification.createdAt, notification.timeZone)}</small>
                        {notification.bookingId ? <em>View appointment</em> : null}
                      </span>
                    </button>
                  )) : (
                    <div className="nav-notification-empty">
                      <BellIcon size={22} />
                      <span>Booking updates and appointment reminders will appear here.</span>
                    </div>
                  )}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
        {isSignedIn ? (
          <button className="nav-avatar" onClick={() => onNavigate('profile')} aria-label="Open profile" title="Open profile">
            {initials}
            {showProfileReminder ? <span className="nav-avatar-alert" aria-label="Complete your profile">!</span> : null}
          </button>
        ) : (
          <button className="btn-primary nav-compact" onClick={() => onNavigate('admin')}>Sign In</button>
        )}
      </div>
    </nav>
  );
}

export default Navbar;
