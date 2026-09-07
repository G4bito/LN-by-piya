import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getCustomerProfile,
  listenToCustomerLoyalty,
  listenToLoyaltyProgram,
  logOut,
  saveCustomerProfile,
  updateAppointmentReminderPreference,
} from '../firebase';
import { SERVICES, formatPeso, NAIL_ART_ADD_ON } from '../constants/services';
import { isValidPhoneNumber } from '../validation';
import { getBookingNailArt, getBookingNailQuantity } from '../bookingPricing';
import { getLoyaltyState } from '../loyaltyProgram';
import LuxeDynamicBackground from '../components/LuxeDynamicBackground';

const NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,60}$/;

function getLocalDateKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTimeMinutes(value) {
  const [hourValue = '0', minuteValue = '0'] = String(value || '').split(':');
  let hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (hour > 0 && hour < 9) hour += 12;
  return (hour * 60) + minute;
}

function compareAppointments(left, right) {
  const dateDifference = String(left?.date || '').localeCompare(String(right?.date || ''));
  if (dateDifference !== 0) return dateDifference;
  return getTimeMinutes(left?.time) - getTimeMinutes(right?.time);
}

function formatAppointmentDate(value) {
  if (!value) return 'Date to be confirmed';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatRewardDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function getServiceName(serviceId) {
  return SERVICES.find((service) => service.id === serviceId)?.title || serviceId || 'Service booked';
}

function getStatusClass(status) {
  const normalizedStatus = String(status || '').toLowerCase();
  if (normalizedStatus === 'confirmed') return 'is-confirmed';
  if (normalizedStatus === 'completed') return 'is-completed';
  if (normalizedStatus === 'cancelled') return 'is-cancelled';
  return 'is-pending';
}

function ProfilePage({ user, bookings = [], onProfileUpdated, onBookAppointment, onBookAgain }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [preferredShape, setPreferredShape] = useState('');
  const [preferredLength, setPreferredLength] = useState('');
  const [preferredFinish, setPreferredFinish] = useState('');
  const [favoriteColor, setFavoriteColor] = useState('');
  const [favoriteService, setFavoriteService] = useState('');
  const [preferredTechnician, setPreferredTechnician] = useState('');
  const [preferenceNotes, setPreferenceNotes] = useState('');
  const [profileStatus, setProfileStatus] = useState('');
  const [preferenceStatus, setPreferenceStatus] = useState('');
  const [notificationPreferenceStatus, setNotificationPreferenceStatus] = useState('');
  const [emailAppointmentReminders, setEmailAppointmentReminders] = useState(true);
  const [notificationPreferenceSaving, setNotificationPreferenceSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loyaltyProfile, setLoyaltyProfile] = useState(null);
  const [loyaltyProgram, setLoyaltyProgram] = useState(null);
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);
  const [loyaltyError, setLoyaltyError] = useState('');
  const [rewardHistoryOpen, setRewardHistoryOpen] = useState(false);
  const [allRewardsOpen, setAllRewardsOpen] = useState(false);
  const rewardModalBodyRef = useRef(null);

  const cleanedName = name.trim().replace(/\s+/g, ' ');
  const cleanedPhone = phone.trim().replace(/[^\d]/g, '').slice(0, 11);
  const cleanedAddress = address.trim();
  const nailPreferences = {
    shape: preferredShape,
    length: preferredLength,
    finish: preferredFinish,
    favoriteColor: favoriteColor.trim(),
    favoriteService,
    preferredTechnician: preferredTechnician.trim(),
    notes: preferenceNotes.trim(),
  };
  const isProfileComplete =
    NAME_REGEX.test(cleanedName) &&
    isValidPhoneNumber(cleanedPhone) &&
    cleanedAddress.length > 0;

  useEffect(() => {
    if (!user) return undefined;

    let isMounted = true;
    const loadProfile = async () => {
      setLoading(true);
      try {
        const cachedProfile = await getCustomerProfile(user.uid, user.email);

        if (!isMounted) return;
        if (cachedProfile) {
          setName(cachedProfile.fullName || cachedProfile.name || user.displayName || '');
          setPhone(cachedProfile.phone || '');
          setAddress(cachedProfile.address || '');
          setPreferredShape(cachedProfile.nailPreferences?.shape || '');
          setPreferredLength(cachedProfile.nailPreferences?.length || '');
          setPreferredFinish(cachedProfile.nailPreferences?.finish || '');
          setFavoriteColor(cachedProfile.nailPreferences?.favoriteColor || '');
          setFavoriteService(cachedProfile.nailPreferences?.favoriteService || '');
          setPreferredTechnician(cachedProfile.nailPreferences?.preferredTechnician || '');
          setPreferenceNotes(cachedProfile.nailPreferences?.notes || '');
          setEmailAppointmentReminders(
            cachedProfile.notificationPreferences?.emailAppointmentReminders !== false
          );
        }
      } catch (error) {
        console.error(error);
        if (isMounted) setProfileStatus('We could not load your profile right now.');
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      isMounted = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user?.uid) return undefined;

    let profileReady = false;
    let programReady = false;
    const markReady = () => {
      if (profileReady && programReady) setLoyaltyLoading(false);
    };

    setLoyaltyLoading(true);
    setLoyaltyError('');
    setRewardHistoryOpen(false);
    setAllRewardsOpen(false);

    const unsubscribeProfile = listenToCustomerLoyalty(
      user.uid,
      (profile) => {
        profileReady = true;
        setLoyaltyProfile(profile);
        setEmailAppointmentReminders(
          profile?.notificationPreferences?.emailAppointmentReminders !== false
        );
        markReady();
      },
      () => {
        profileReady = true;
        setLoyaltyError('Your loyalty progress could not be refreshed right now.');
        markReady();
      }
    );
    const unsubscribeProgram = listenToLoyaltyProgram(
      (program) => {
        programReady = true;
        setLoyaltyProgram(program);
        markReady();
      },
      () => {
        programReady = true;
        setLoyaltyError('Reward details are temporarily unavailable.');
        markReady();
      }
    );

    return () => {
      unsubscribeProfile();
      unsubscribeProgram();
    };
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    onProfileUpdated?.({
      name: cleanedName,
      phone: cleanedPhone,
      address: cleanedAddress,
      isComplete: isProfileComplete,
    });
  }, [cleanedAddress, cleanedName, cleanedPhone, isProfileComplete, onProfileUpdated, user]);

  useEffect(() => {
    if (!profileStatus) return undefined;
    const timer = window.setTimeout(() => setProfileStatus(''), 3000);
    return () => window.clearTimeout(timer);
  }, [profileStatus]);

  useEffect(() => {
    if (!preferenceStatus) return undefined;
    const timer = window.setTimeout(() => setPreferenceStatus(''), 3000);
    return () => window.clearTimeout(timer);
  }, [preferenceStatus]);

  useEffect(() => {
    if (!notificationPreferenceStatus) return undefined;
    const timer = window.setTimeout(() => setNotificationPreferenceStatus(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notificationPreferenceStatus]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!user) return;

    if (!NAME_REGEX.test(cleanedName)) {
      setProfileStatus('Please enter a valid name with 2-60 letters.');
      return;
    }

    if (!isValidPhoneNumber(cleanedPhone)) {
      setProfileStatus('Please enter a valid Philippine phone number.');
      return;
    }

    if (!cleanedAddress) {
      setProfileStatus('Please enter your address.');
      return;
    }

    setProfileStatus('Saving...');
    try {
      await saveCustomerProfile(user, {
        name: cleanedName,
        phone: cleanedPhone,
        address: cleanedAddress,
        nailPreferences,
        notificationPreferences: { emailAppointmentReminders },
      });
      onProfileUpdated?.({ name: cleanedName, phone: cleanedPhone, address: cleanedAddress, isComplete: true });
      setProfileStatus('Profile saved successfully.');
    } catch (error) {
      console.error(error);
      setProfileStatus('We could not save your profile yet.');
    }
  };

  const handlePreferencesSubmit = async (event) => {
    event.preventDefault();
    if (!user) return;

    setPreferenceStatus('Saving...');
    try {
      await saveCustomerProfile(user, {
        name: cleanedName,
        phone: cleanedPhone,
        address: cleanedAddress,
        nailPreferences,
        notificationPreferences: { emailAppointmentReminders },
      });
      setPreferenceStatus('Nail preferences saved.');
    } catch (error) {
      console.error(error);
      setPreferenceStatus('We could not save your preferences yet.');
    }
  };

  const handleEmailReminderToggle = async () => {
    if (!user?.uid || notificationPreferenceSaving) return;
    const nextValue = !emailAppointmentReminders;
    setEmailAppointmentReminders(nextValue);
    setNotificationPreferenceSaving(true);
    setNotificationPreferenceStatus('Saving...');
    try {
      await updateAppointmentReminderPreference(user.uid, nextValue);
      setNotificationPreferenceStatus(
        nextValue ? 'Email appointment reminders are on.' : 'Email appointment reminders are off.'
      );
    } catch (error) {
      console.error(error);
      setEmailAppointmentReminders(!nextValue);
      setNotificationPreferenceStatus('We could not update this preference yet.');
    } finally {
      setNotificationPreferenceSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logOut();
    } catch (error) {
      console.error(error);
    }
  };

  const appointmentData = useMemo(() => {
    const today = getLocalDateKey();
    const completed = bookings
      .filter((booking) => String(booking.status || '').toLowerCase() === 'completed')
      .sort((left, right) => compareAppointments(right, left));
    const upcoming = bookings
      .filter((booking) => {
        const normalizedStatus = String(booking.status || '').toLowerCase();
        return booking.date >= today && normalizedStatus !== 'cancelled' && normalizedStatus !== 'completed';
      })
      .sort(compareAppointments);
    const history = [...bookings].sort((left, right) => compareAppointments(right, left));
    return { completed, next: upcoming[0] || null, history };
  }, [bookings]);

  const loyaltyState = useMemo(
    () => getLoyaltyState(loyaltyProfile, appointmentData.completed.length, loyaltyProgram),
    [appointmentData.completed.length, loyaltyProfile, loyaltyProgram]
  );
  const rewardPreview = useMemo(() => {
    const priority = { available: 0, locked: 1, claimed: 2 };
    return [...loyaltyState.milestones]
      .sort((left, right) => priority[left.status] - priority[right.status] || left.requiredVisits - right.requiredVisits)
      .slice(0, 3);
  }, [loyaltyState.milestones]);
  const nextBookingQuantity = getBookingNailQuantity(appointmentData.next);
  const nextBookingService = SERVICES.find((serviceItem) => serviceItem.id === appointmentData.next?.service);
  const nextBookingNailArt = getBookingNailArt(appointmentData.next, nextBookingService);
  const displayName = name || user?.displayName || 'Welcome';
  const initials = displayName
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    if (!allRewardsOpen) return undefined;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => {
      if (rewardModalBodyRef.current) rewardModalBodyRef.current.scrollTop = 0;
    });
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setAllRewardsOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [allRewardsOpen]);

  return (
    <main className="profile-page">
      <LuxeDynamicBackground className="customer-page-waves" />
      <header className="hero hero-compact customer-page-hero">
        <div className="hero-content">
          <span className="eyebrow">Your salon profile</span>
          <h1>Customer Profile</h1>
          <p className="subtitle">Appointments, rewards, and saved preferences</p>
        </div>
      </header>

      <section className="profile-shell">
        <div className="profile-header-card card">
          <div className="profile-avatar">{initials}</div>
          <div className="profile-header-copy">
            <h2>{displayName}</h2>
            <p>{user?.email || 'Signed in with your account'}</p>
            <div className="profile-header-actions">
              <button type="button" className="btn-primary" onClick={handleLogout}>Logout</button>
            </div>
          </div>
        </div>

        <div className="profile-grid">
          <div className="card profile-card">
            <h3>Profile details</h3>
            <p className="profile-intro">Keep your contact info up to date for smoother appointments.</p>

            <form onSubmit={handleSubmit} className="profile-form">
              <label className="field-floating">
                <span>Full name <span className="field-required">*</span></span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ' -]/g, ''))}
                  placeholder="Your name"
                />
              </label>

              <label className="field-floating">
                <span>Phone / Contact <span className="field-required">*</span></span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value.replace(/[^\d]/g, '').slice(0, 11))}
                  placeholder="09xx xxx xxxx"
                  inputMode="numeric"
                />
              </label>

              <label className="field-floating">
                <span>Email</span>
                <input value={user?.email || ''} readOnly />
              </label>

              <label className="field-floating">
                <span>Address <span className="field-required">*</span></span>
                <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Home address" />
              </label>

              <div className="profile-form-actions">
                {!isProfileComplete ? (
                  <p className="profile-warning">
                    Please fill in your full name, a valid 11-digit contact number, and your address before continuing.
                  </p>
                ) : null}
                <button type="submit" className="btn-primary profile-submit">Save profile</button>
                {profileStatus ? <p className="profile-status" role="status">{profileStatus}</p> : null}
              </div>
            </form>
          </div>

          <div className="card profile-summary-card">
            <h3>Customer information</h3>
            <div className="profile-metric">
              <span>Full name</span>
              <strong>{displayName}</strong>
            </div>
            <div className="profile-metric">
              <span>Email</span>
              <strong>{user?.email || 'Not available'}</strong>
            </div>
            <div className="profile-metric">
              <span>Phone</span>
              <strong>{phone || 'Add your phone number'}</strong>
            </div>
            <div className="profile-metric">
              <span>Total bookings</span>
              <strong>{bookings.length}</strong>
            </div>
          </div>

          <div className="card profile-upcoming-card">
            <h3>Upcoming appointment</h3>
            {loading ? (
              <p className="muted">Loading your appointment...</p>
            ) : appointmentData.next ? (
              <>
                <div className="profile-appointment-heading">
                  <strong>{getServiceName(appointmentData.next.service)}</strong>
                  <span className={`profile-status-badge ${getStatusClass(appointmentData.next.status)}`}>
                    {appointmentData.next.status || 'Pending Confirmation'}
                  </span>
                </div>
                <div className="profile-metric">
                  <span>Date</span>
                  <strong>{formatAppointmentDate(appointmentData.next.date)}</strong>
                </div>
                <div className="profile-metric">
                  <span>Time</span>
                  <strong>{appointmentData.next.time || 'To be confirmed'}</strong>
                </div>
                {nextBookingQuantity ? (
                  <>
                    <div className="profile-metric">
                      <span>Nail quantity</span>
                      <strong>{nextBookingQuantity} {nextBookingQuantity === 1 ? 'nail' : 'nails'}</strong>
                    </div>
                    <div className="profile-metric">
                      <span>Price per nail</span>
                      <strong>{formatPeso(appointmentData.next.pricePerNail || nextBookingService?.price || 0)}</strong>
                    </div>
                  </>
                ) : null}
                <div className="profile-metric">
                  <span>Nail Art</span>
                  <strong>{nextBookingNailArt.enabled ? `${nextBookingNailArt.quantity} nails × ${formatPeso(NAIL_ART_ADD_ON.pricePerNail)}` : 'None'}</strong>
                </div>
                {nextBookingNailArt.enabled ? (
                  <div className="profile-metric">
                    <span>Nail Art Add-on</span>
                    <strong>{formatPeso(nextBookingNailArt.total)}</strong>
                  </div>
                ) : null}
                {nextBookingService?.nailArtEligible ? (
                  <div className="profile-metric">
                    <span>Reference photo</span>
                    <strong>{appointmentData.next.referenceImageUrl ? 'Attached ✓' : 'Not attached'}</strong>
                  </div>
                ) : null}
                {appointmentData.next.estimatedTotal || appointmentData.next.totalPrice ? (
                  <div className="profile-metric">
                    <span>Estimated total</span>
                    <strong>{formatPeso(appointmentData.next.estimatedTotal || appointmentData.next.totalPrice)}</strong>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="profile-empty-state">
                <p className="muted">You have no upcoming appointments.</p>
                <button type="button" className="btn-primary" onClick={onBookAppointment}>Book an appointment</button>
              </div>
            )}
          </div>

          <div className={`card profile-loyalty-card ${loyaltyState.availableRewards > 0 ? 'is-reward-available' : ''}`}>
            <h3>Loyalty rewards</h3>
            <p className="profile-intro">Each completed appointment adds one lifetime visit toward your rewards.</p>

            <div className="profile-loyalty-summary">
              <div className="profile-metric">
                <span>Total visits</span>
                <strong>{loyaltyState.completedVisits}</strong>
              </div>
              <div className="profile-metric">
                <span>Rewards unlocked</span>
                <strong>{loyaltyState.unlockedRewards}</strong>
              </div>
              <div className="profile-metric">
                <span>Rewards claimed</span>
                <strong>{loyaltyState.claimedRewards}</strong>
              </div>
            </div>

            {loyaltyLoading ? (
              <p className="profile-reward-empty" role="status">Loading reward milestones...</p>
            ) : loyaltyState.program.active ? (
              <>
                <section className="profile-next-reward is-locked" aria-labelledby="next-reward-heading">
                  {loyaltyState.nextReward ? (
                    <>
                      <div className="profile-next-reward-heading">
                        <span className="profile-reward-kicker" id="next-reward-heading">Next reward</span>
                        <span className="profile-reward-status is-locked">Locked</span>
                      </div>
                      <h4>{loyaltyState.nextReward.name}</h4>
                      <p>{loyaltyState.nextReward.description}</p>
                      <div
                        className="profile-loyalty-track"
                        role="progressbar"
                        aria-label={`Progress toward ${loyaltyState.nextReward.name}`}
                        aria-valuemin="0"
                        aria-valuemax={loyaltyState.nextReward.requiredVisits}
                        aria-valuenow={loyaltyState.nextReward.progress}
                      >
                        <span style={{ width: `${(loyaltyState.nextReward.progress / loyaltyState.nextReward.requiredVisits) * 100}%` }} />
                      </div>
                      <p className="profile-loyalty-copy">
                        {loyaltyState.nextReward.progress} / {loyaltyState.nextReward.requiredVisits} visits ·{' '}
                        {loyaltyState.nextReward.remainingVisits} more {loyaltyState.nextReward.remainingVisits === 1 ? 'visit' : 'visits'} to unlock.
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="profile-reward-kicker" id="next-reward-heading">Milestone progress</span>
                      <p className="profile-all-rewards-message">All current loyalty rewards have been unlocked.</p>
                    </>
                  )}
                </section>

                {loyaltyState.availableRewards > 0 ? (
                  <p className="profile-available-rewards">{loyaltyState.availableRewards} {loyaltyState.availableRewards === 1 ? 'reward is' : 'rewards are'} available to use.</p>
                ) : null}
                <button type="button" className="profile-view-all-rewards" onClick={() => setAllRewardsOpen(true)}>
                  View all rewards <span aria-hidden="true">→</span>
                </button>
              </>
            ) : (
              <section className="profile-next-reward" aria-labelledby="next-reward-heading">
                <p className="profile-reward-empty" id="next-reward-heading">No loyalty rewards are currently available.</p>
              </section>
            )}

            {loyaltyError ? <p className="profile-loyalty-error" role="status">{loyaltyError}</p> : null}

            {loyaltyState.rewardHistory.length > 0 ? (
              <div className="profile-reward-history-wrap">
                <button
                  type="button"
                  className="profile-reward-history-toggle"
                  onClick={() => setRewardHistoryOpen((open) => !open)}
                  aria-expanded={rewardHistoryOpen}
                  aria-controls="profile-reward-history"
                >
                  {rewardHistoryOpen ? 'Hide reward history' : 'View reward history'}
                </button>
                {rewardHistoryOpen ? (
                  <div className="profile-reward-history" id="profile-reward-history">
                    {loyaltyState.rewardHistory.map((reward) => (
                      <article key={reward.id}>
                        <strong>{reward.rewardName}</strong>
                        {reward.unlockedAt ? <span>Unlocked: {formatRewardDate(reward.unlockedAt)}</span> : null}
                        <span>Claimed: {formatRewardDate(reward.claimedAt)}</span>
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <section className="card profile-all-rewards-card" aria-labelledby="your-rewards-heading">
            <div className="profile-all-rewards-heading">
              <div>
                <h3 id="your-rewards-heading">Your rewards</h3>
                <p className="profile-intro">A quick look at your current reward milestones.</p>
              </div>
              <button type="button" className="profile-view-all-rewards" onClick={() => setAllRewardsOpen(true)}>View all rewards <span aria-hidden="true">→</span></button>
            </div>
            {loyaltyLoading ? (
              <p className="profile-reward-empty" role="status">Loading reward milestones...</p>
            ) : rewardPreview.length > 0 ? (
              <div className="profile-reward-preview-list">
                {rewardPreview.map((reward) => (
                  <article className={`profile-reward-preview is-${reward.status}`} key={reward.id}>
                    <div className="profile-reward-milestone-top">
                      <span className="profile-reward-visit-count">{reward.requiredVisits} {reward.requiredVisits === 1 ? 'visit' : 'visits'}</span>
                      <span className={`profile-reward-status is-${reward.status}`}>{reward.status}</span>
                    </div>
                    <h4>{reward.name}</h4>
                    {reward.status === 'locked' ? <p>{reward.progress} / {reward.requiredVisits} visits · {reward.remainingVisits} remaining</p> : null}
                    {reward.status === 'available' ? <p className="profile-milestone-ready">Reward unlocked · Available to use</p> : null}
                    {reward.status === 'claimed' ? <p className="profile-milestone-claimed">Claimed{reward.claimedAt ? ` · ${formatRewardDate(reward.claimedAt)}` : ''}</p> : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="profile-empty-state"><p className="muted">No rewards available yet. New loyalty rewards will appear here when available.</p></div>
            )}
          </section>

          <div className="card profile-preferences-card">
            <h3>Nail preferences</h3>
            <p className="profile-intro">Save your usual style so it is easy to reference during future appointments.</p>
            <form className="profile-preferences-form" onSubmit={handlePreferencesSubmit}>
              <label className="field-floating">
                <span>Preferred nail shape</span>
                <select value={preferredShape} onChange={(event) => setPreferredShape(event.target.value)}>
                  <option value="">No preference</option>
                  <option value="Round">Round</option>
                  <option value="Oval">Oval</option>
                  <option value="Almond">Almond</option>
                  <option value="Square">Square</option>
                  <option value="Coffin">Coffin</option>
                  <option value="Stiletto">Stiletto</option>
                </select>
              </label>
              <label className="field-floating">
                <span>Preferred nail length</span>
                <select value={preferredLength} onChange={(event) => setPreferredLength(event.target.value)}>
                  <option value="">No preference</option>
                  <option value="Short">Short</option>
                  <option value="Medium">Medium</option>
                  <option value="Long">Long</option>
                  <option value="Extra long">Extra long</option>
                </select>
              </label>
              <label className="field-floating">
                <span>Preferred finish</span>
                <select value={preferredFinish} onChange={(event) => setPreferredFinish(event.target.value)}>
                  <option value="">No preference</option>
                  <option value="Glossy">Glossy</option>
                  <option value="Matte">Matte</option>
                  <option value="Chrome">Chrome</option>
                  <option value="Natural">Natural</option>
                </select>
              </label>
              <label className="field-floating">
                <span>Favorite nail color</span>
                <input
                  value={favoriteColor}
                  onChange={(event) => setFavoriteColor(event.target.value.slice(0, 60))}
                  placeholder="e.g. Nude pink"
                />
              </label>
              <label className="field-floating">
                <span>Favorite service</span>
                <select value={favoriteService} onChange={(event) => setFavoriteService(event.target.value)}>
                  <option value="">No preference</option>
                  {SERVICES.map((serviceItem) => (
                    <option key={serviceItem.id} value={serviceItem.title}>{serviceItem.title}</option>
                  ))}
                </select>
              </label>
              <label className="field-floating">
                <span>Preferred nail technician</span>
                <input
                  value={preferredTechnician}
                  onChange={(event) => setPreferredTechnician(event.target.value.slice(0, 60))}
                  placeholder="No preference"
                />
              </label>
              <label className="field-floating profile-preference-notes">
                <span>Colors, sensitivities, or notes</span>
                <textarea
                  value={preferenceNotes}
                  onChange={(event) => setPreferenceNotes(event.target.value.slice(0, 240))}
                  placeholder="Favorite colors, allergies, or anything your nail tech should know"
                  rows="3"
                />
              </label>
              <div className="profile-preference-actions">
                <button type="submit" className="btn-primary">Save preferences</button>
                {preferenceStatus ? <p className="profile-status" role="status">{preferenceStatus}</p> : null}
              </div>
            </form>
          </div>

          <div className="card profile-notifications-card">
            <div>
              <h3>Notification preferences</h3>
              <p className="profile-intro">Choose whether appointment reminder emails are sent to {user?.email || 'your account email'}.</p>
              <small>In-app reminders will still appear in your notification bell.</small>
            </div>
            <div className="profile-notification-control">
              <span>
                <strong>Email appointment reminders</strong>
                <small>24 hours and 12 hours before confirmed appointments</small>
              </span>
              <button
                type="button"
                className={`profile-notification-switch ${emailAppointmentReminders ? 'is-on' : ''}`}
                role="switch"
                aria-checked={emailAppointmentReminders}
                aria-label="Email appointment reminders"
                disabled={notificationPreferenceSaving}
                onClick={handleEmailReminderToggle}
              >
                <span aria-hidden="true" />
                <b>{emailAppointmentReminders ? 'On' : 'Off'}</b>
              </button>
              {notificationPreferenceStatus ? (
                <p className="profile-status" role="status">{notificationPreferenceStatus}</p>
              ) : null}
            </div>
          </div>

          <div className="card history-card">
            <h3>Booking history</h3>
            {loading ? (
              <p className="muted">Loading your history...</p>
            ) : appointmentData.history.length === 0 ? (
              <p className="muted">No bookings yet. Your visits will appear here.</p>
            ) : (
              <ul className="history-list">
                {appointmentData.history.map((booking) => {
                  const bookingQuantity = getBookingNailQuantity(booking);
                  const bookingService = SERVICES.find((serviceItem) => serviceItem.id === booking.service);
                  const bookingNailArt = getBookingNailArt(booking, bookingService);
                  return (
                    <li key={booking.id} className="history-item">
                      <div className="history-item-copy">
                        <strong>{getServiceName(booking.service)}</strong>
                        <p>{formatAppointmentDate(booking.date)} {'\u00b7'} {booking.time || 'Time to be confirmed'}</p>
                        <small>Booked for {booking.customerName || name || 'Guest'}</small>
                        {bookingQuantity ? (
                          <small>
                            {bookingQuantity} {bookingQuantity === 1 ? 'nail' : 'nails'} at {formatPeso(booking.pricePerNail || bookingService?.price || 0)} / nail
                          </small>
                        ) : null}
                        <small>Nail Art: {bookingNailArt.enabled ? `${bookingNailArt.quantity} nails × ${formatPeso(NAIL_ART_ADD_ON.pricePerNail)} = ${formatPeso(bookingNailArt.total)}` : 'None'}</small>
                        {bookingService?.nailArtEligible ? <small>Reference photo: {booking.referenceImageUrl ? 'Attached ✓' : 'Not attached'}</small> : null}
                      </div>
                      <div className="history-item-meta">
                        <span className={`profile-status-badge ${getStatusClass(booking.status)}`}>
                          {booking.status || 'Pending Confirmation'}
                        </span>
                        {booking.estimatedTotal || booking.totalPrice ? <strong>{formatPeso(booking.estimatedTotal || booking.totalPrice)}</strong> : null}
                        {bookingService ? (
                          <button type="button" className="btn-secondary history-book-again" onClick={() => onBookAgain?.(booking)}>
                            Book Again
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </section>

      {allRewardsOpen && typeof document !== 'undefined' ? createPortal((
        <div className="profile-rewards-overlay" role="dialog" aria-modal="true" aria-labelledby="all-rewards-heading" onClick={() => setAllRewardsOpen(false)}>
          <section className="profile-rewards-dialog" onClick={(event) => event.stopPropagation()}>
            <header className="profile-rewards-dialog-header">
              <div><span className="profile-reward-kicker">Reward milestones</span><h2 id="all-rewards-heading">All rewards</h2></div>
              <button type="button" className="profile-rewards-dialog-close" onClick={() => setAllRewardsOpen(false)} aria-label="Close all rewards">×</button>
            </header>
            <div ref={rewardModalBodyRef} className="profile-rewards-dialog-body">
              {!loyaltyState.program.active || loyaltyState.milestones.length === 0 ? (
                <div className="profile-empty-state"><strong>No rewards available yet</strong><p className="muted">New loyalty rewards will appear here when available.</p></div>
              ) : loyaltyState.milestones.map((reward) => (
                <article className={`profile-reward-milestone is-${reward.status}`} key={reward.id}>
                  <div className="profile-reward-milestone-top"><span className="profile-reward-visit-count">{reward.requiredVisits} {reward.requiredVisits === 1 ? 'visit' : 'visits'}</span><span className={`profile-reward-status is-${reward.status}`}>{reward.status}</span></div>
                  <h4>{reward.name}</h4>
                  <p>{reward.description}</p>
                  {reward.status === 'locked' ? <div className="profile-milestone-progress"><span>{reward.progress} / {reward.requiredVisits} visits</span><small>{reward.remainingVisits} more {reward.remainingVisits === 1 ? 'visit' : 'visits'} to unlock</small></div> : null}
                  {reward.status === 'available' ? <p className="profile-milestone-ready">Reward unlocked · Available to use</p> : null}
                  {reward.status === 'claimed' ? <p className="profile-milestone-claimed">Claimed{reward.claimedAt ? ` · ${formatRewardDate(reward.claimedAt)}` : ''}</p> : null}
                </article>
              ))}
            </div>
          </section>
        </div>
      ), document.body) : null}
    </main>
  );
}

export default ProfilePage;
