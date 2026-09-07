import { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import Navbar from './components/Navbar';
import { subscribeToAuthChanges, logOut, createOrUpdateCustomerRecord, getCustomerProfile, updateUserStatus, getAccountStatus, listenToPortfolio, listenToBusinessSettings, listenToUserBookings, listenToCustomerNotifications, markCustomerNotificationsRead, addPortfolioItem, updatePortfolioItem, deletePortfolioItem, prepareImageForUpload, uploadImageFile } from './firebase';
import { SERVICES } from './constants/services';
import { isValidPhoneNumber } from './validation';
import { createServiceBookingSelection, getBookingNailArt, serviceSupportsNailArt } from './bookingPricing';
import { getPostAuthDestination } from './authFlow';

const HomePage = lazy(() => import('./pages/HomePage'));
const BookingPage = lazy(() => import('./pages/BookingPage'));
const Login = lazy(() => import('./pages/Login'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const PortfolioPage = lazy(() => import('./pages/PortfolioPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));

const CUSTOMER_NOTIFICATION_LIMIT = 20;

function getCustomerNotificationStorageKey(uid) {
  return `luxe-nails-booking-notifications:${uid}`;
}

function readCustomerNotifications(uid) {
  if (!uid || typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getCustomerNotificationStorageKey(uid)) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, CUSTOMER_NOTIFICATION_LIMIT) : [];
  } catch (error) {
    console.warn('Unable to read booking notifications', error);
    return [];
  }
}

function writeCustomerNotifications(uid, notifications) {
  if (!uid || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      getCustomerNotificationStorageKey(uid),
      JSON.stringify(notifications.slice(0, CUSTOMER_NOTIFICATION_LIMIT))
    );
  } catch (error) {
    console.warn('Unable to save booking notifications', error);
  }
}

function createBookingConfirmationNotification(booking) {
  const service = SERVICES.find((item) => item.id === booking.service);
  const serviceName = service?.title || String(booking.service || 'Appointment').replace(/[-_]/g, ' ');
  const schedule = [booking.date, booking.time].filter(Boolean).join(' at ');
  return {
    id: `booking-confirmed:${booking.id}`,
    bookingId: booking.id,
    message: `${serviceName}${schedule ? ` on ${schedule}` : ''} was accepted by the admin.`,
    createdAt: booking.updatedAt || new Date().toISOString(),
    read: false,
  };
}

function getNotificationTimestamp(notification) {
  if (typeof notification?.createdAt === 'number') return notification.createdAt;
  const parsed = Date.parse(notification?.createdAt || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function playCustomerNotificationSound() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();

    const playChime = async () => {
      if (context.state === 'suspended') await context.resume();
      const now = context.currentTime;
      [659.25, 880].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const startAt = now + index * 0.14;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.34);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.36);
      });
      window.setTimeout(() => context.close().catch(() => {}), 850);
    };

    playChime().catch((error) => console.warn('Booking notification sound was blocked', error));
  } catch (error) {
    console.warn('Booking notification sound failed', error);
  }
}

async function uploadPortfolioImages(file, progressCallback) {
  const image = await uploadImageFile(file, 'portfolio', (progress) => {
    progressCallback?.(Math.round(progress * 0.8));
  });

  let thumbnail = image;
  try {
    thumbnail = await uploadImageFile(file, 'portfolio-thumbnails', (progress) => {
      progressCallback?.(80 + Math.round(progress * 0.2));
    }, { maxDimension: 720, quality: 0.84 });
  } catch (error) {
    console.warn('Portfolio thumbnail upload failed; using the optimized full image.', error);
  }

  return { image, thumbnail };
}

function App() {
  const [currentPage, setCurrentPage] = useState('home');
  const [selectedService, setSelectedService] = useState(null);
  const [works, setWorks] = useState([]);
  const [businessInfo, setBusinessInfo] = useState({});
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [pendingBooking, setPendingBooking] = useState(false);
  const [showBookingPrompt, setShowBookingPrompt] = useState(false);
  const [bookingPromptKey, setBookingPromptKey] = useState(0);
  const [bannerVisible, setBannerVisible] = useState(false);
  const [bannerFading, setBannerFading] = useState(false);
  const [user, setUser] = useState(null);
  const [authProcessing, setAuthProcessing] = useState(false);
  const [profileNeedsCompletion, setProfileNeedsCompletion] = useState(false);
  const [authErrorMessage, setAuthErrorMessage] = useState('');
  const [backendError, setBackendError] = useState('');
  const [customerBookings, setCustomerBookings] = useState([]);
  const [customerNotifications, setCustomerNotifications] = useState([]);
  const [appointmentNotifications, setAppointmentNotifications] = useState([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [bookingStatusToast, setBookingStatusToast] = useState(null);

  const isAdmin = isSignedIn && user?.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL?.toLowerCase();
  const visibleCustomerNotifications = useMemo(() => {
    const notificationsById = new Map();
    [...appointmentNotifications, ...customerNotifications].forEach((notification) => {
      if (notification?.id && !notificationsById.has(notification.id)) {
        notificationsById.set(notification.id, notification);
      }
    });
    return [...notificationsById.values()]
      .sort((left, right) => getNotificationTimestamp(right) - getNotificationTimestamp(left))
      .slice(0, CUSTOMER_NOTIFICATION_LIMIT);
  }, [appointmentNotifications, customerNotifications]);

  const hideBanner = () => {
    setBannerFading(true);
    window.setTimeout(() => {
      setBannerVisible(false);
      setBannerFading(false);
    }, 220);
  };

  const hasRequiredProfileFields = (profile) => {
    const fullNameValue = String(profile?.fullName || profile?.name || '').trim();
    const phoneValue = String(profile?.phone || '').trim();
    const addressValue = String(profile?.address || '').trim();
    const hasFullName = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,60}$/.test(fullNameValue);
    const hasPhone = isValidPhoneNumber(phoneValue);
    const hasAddress = addressValue.length > 0;
    return hasFullName && hasPhone && hasAddress;
  };

  const loadProfileCompletion = async (authUser) => {
    try {
      const profile = await getCustomerProfile(authUser.uid, authUser.email);
      return !hasRequiredProfileFields(profile);
    } catch (error) {
      console.warn('Unable to check profile completeness', error);
      return true;
    }
  };

  // Convert a File to a data URL (used as fallback when Storage isn't configured)
  const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    if (!file) return resolve('');
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error);
    }
  });

  const handleAddWork = async (newWork, progressCallback) => {
    const newPosition = works.length > 0 ? Math.max(...works.map((work) => Number(work.position) || 0)) + 1 : 0;
    const itemToSave = { ...newWork, position: newPosition };

    try {
      const file = itemToSave.imageFile;
      if (file instanceof File) {
        try {
          const uploadedImages = await uploadPortfolioImages(file, progressCallback);
          itemToSave.image = uploadedImages.image;
          itemToSave.thumbnail = uploadedImages.thumbnail;
        } catch (err) {
          console.error('Background upload failed, attempting data-URL fallback:', err);
          try {
            const optimizedFile = await prepareImageForUpload(file, 'portfolio');
            itemToSave.image = await fileToDataUrl(optimizedFile);
            itemToSave.thumbnail = itemToSave.image;
          } catch (rerr) {
            console.error('Failed to create data-URL fallback:', rerr);
            throw err;
          }
        }
      }
      delete itemToSave.imageFile;
      await addPortfolioItem(itemToSave);
      setWorks((prev) => {
        const exists = prev.some((w) => String(w.id) === String(itemToSave.id));
        if (exists) return prev.map((w) => (String(w.id) === String(itemToSave.id) ? { ...w, ...itemToSave } : w));
        return [{ ...itemToSave }, ...prev];
      });
    } catch (error) {
      console.error('Failed to add portfolio item:', error);
      throw error;
    }
  };

  const handleDeleteWork = async (id) => {
    try {
      await deletePortfolioItem(id);
      setWorks((prevWorks) => prevWorks.filter((work) => work.id !== id));
    } catch (error) {
      console.error('Failed to delete portfolio item:', error);
      setWorks((prevWorks) => prevWorks.filter((work) => work.id !== id));
    }
  };

  const handleUpdateWork = async (id, updates, progressCallback) => {
    try {
      const updatesToSave = { ...updates };

      // If there's an imageFile, keep preview in place and upload in background
      const file = updatesToSave.imageFile;
      if (file instanceof File) {
        // if caller provided a preview string, keep it for immediate display
        try {
          const uploadedImages = await uploadPortfolioImages(file, progressCallback);
          updatesToSave.image = uploadedImages.image;
          updatesToSave.thumbnail = uploadedImages.thumbnail;
        } catch (err) {
          console.error('Update background upload failed, attempting data-URL fallback:', err);
          try {
            const optimizedFile = await prepareImageForUpload(file, 'portfolio');
            updatesToSave.image = await fileToDataUrl(optimizedFile);
            updatesToSave.thumbnail = updatesToSave.image;
          } catch (rerr) {
            console.error('Failed to create data-URL fallback during update:', rerr);
            throw err;
          }
        }
      }

      // no file — normal update
      delete updatesToSave.imageFile;
      await updatePortfolioItem(id, updatesToSave);
      setWorks((prevWorks) => prevWorks.map((work) => (work.id === id ? { ...work, ...updatesToSave } : work)));
    } catch (error) {
      console.error('Failed to update portfolio item:', error);
      throw error;
    }
  };

  const handleMoveWork = async (id, direction) => {
    const currentIndex = works.findIndex((work) => work.id === id);
    if (currentIndex === -1) return;

    const nextIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= works.length) return;

    const reordered = [...works];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    const updatedWorks = reordered.map((work, position) => ({ ...work, position }));

    setWorks(updatedWorks);

    try {
      await Promise.all([
        updatePortfolioItem(updatedWorks[currentIndex].id, { position: updatedWorks[currentIndex].position }),
        updatePortfolioItem(updatedWorks[nextIndex].id, { position: updatedWorks[nextIndex].position }),
      ]);
    } catch (error) {
      console.error('Failed to reorder portfolio items:', error);
    }
  };

  useEffect(() => {
    if (window.location.hash === '#/admin') setCurrentPage('admin');
  }, []);

  useEffect(() => {
    let isMounted = true;
    let authEventId = 0;

    const unsubscribe = subscribeToAuthChanges(async (authUser) => {
      const eventId = ++authEventId;
      if (!isMounted) return;

      if (authUser) {
        try {
          const accountStatus = await getAccountStatus(authUser.uid, authUser.email);
          if (!isMounted || eventId !== authEventId) return;
          if (accountStatus === 'inactive') {
            setAuthErrorMessage('Your account has been deactivated. Please contact support.');
            setUser(null);
            setIsSignedIn(false);
            setProfileNeedsCompletion(false);
            setCurrentPage(authUser.email?.toLowerCase() === import.meta.env.VITE_ADMIN_EMAIL?.toLowerCase() ? 'admin' : 'home');
            setAuthReady(true);
            await logOut();
            return;
          }

          await createOrUpdateCustomerRecord(authUser);
          if (!isMounted || eventId !== authEventId) return;
          const needsCompletion = await loadProfileCompletion(authUser);
          if (!isMounted || eventId !== authEventId) return;
          setUser(authUser);
          setIsSignedIn(true);
          setProfileNeedsCompletion(needsCompletion);
          setAuthErrorMessage('');
          setAuthReady(true);
        } catch (error) {
          if (!isMounted || eventId !== authEventId) return;
          console.warn('Customer record sync failed', error);
          setUser(authUser);
          setIsSignedIn(true);
          setAuthReady(true);
        }
      } else {
        setUser(null);
        setIsSignedIn(false);
        setAuthReady(true);
        setProfileNeedsCompletion(false);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authReady && isSignedIn && pendingBooking) {
      setPendingBooking(false);
      setShowBookingPrompt(false);
      setCurrentPage('booking');
    }
  }, [authReady, isSignedIn, pendingBooking]);

  useEffect(() => {
    if (authReady && !isSignedIn && currentPage === 'profile') {
      setCurrentPage('home');
    }
  }, [authReady, isSignedIn, currentPage]);

  useEffect(() => {
    if (authReady && isSignedIn && currentPage === 'admin' && !isAdmin) {
      setCurrentPage(pendingBooking ? 'booking' : 'home');
    }
  }, [authReady, currentPage, isAdmin, isSignedIn, pendingBooking]);

  useEffect(() => {
    if (authReady && isAdmin && !['admin', 'profile'].includes(currentPage)) {
      setCurrentPage('admin');
    }
  }, [authReady, isAdmin, currentPage]);

  useEffect(() => {
    const needsPortfolio = currentPage === 'home'
      || currentPage === 'portfolio'
      || (currentPage === 'admin' && isAdmin);
    if (!needsPortfolio) return undefined;

    const unsubscribe = listenToPortfolio((items) => {
      if (!Array.isArray(items)) return;
      setWorks(items);
      setBackendError('');
    }, (error) => {
      console.warn('Portfolio realtime listener failed:', error);
      const permissionDenied = String(error?.code || '').toLowerCase().includes('permission');
      setBackendError(
        permissionDenied
          ? 'Firebase denied access to the portfolio. Publish the Realtime Database rules for this project, then reload the page.'
          : 'Unable to sync the portfolio with Realtime Database. Check your connection and Firebase settings.'
      );
    }, { includeHidden: isAdmin });

    return () => unsubscribe();
  }, [currentPage, isAdmin]);

  useEffect(() => {
    if (isAdmin || !['home', 'portfolio'].includes(currentPage)) return undefined;
    return listenToBusinessSettings((settings) => {
      setBusinessInfo({
        ...settings,
        location: settings?.location || settings?.address || '',
        hours: settings?.hours || settings?.businessHours || '',
      });
    }, (error) => {
      console.warn('Business settings realtime listener failed:', error);
    });
  }, [currentPage, isAdmin]);

  useEffect(() => {
    if (!isSignedIn || isAdmin || !user?.uid) {
      setCustomerBookings([]);
      setCustomerNotifications([]);
      setNotificationOpen(false);
      setBookingStatusToast(null);
      return undefined;
    }

    const uid = user.uid;
    setCustomerNotifications(readCustomerNotifications(uid));

    const unsubscribe = listenToUserBookings(
      uid,
      (bookings) => {
        setCustomerBookings(bookings);
        const storedNotifications = readCustomerNotifications(uid);
        const knownNotificationIds = new Set(storedNotifications.map((notification) => notification.id));
        const newNotifications = bookings
          .filter((booking) => booking.id && booking.status === 'Confirmed')
          .map(createBookingConfirmationNotification)
          .filter((notification) => !knownNotificationIds.has(notification.id))
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

        if (!newNotifications.length) return;

        const nextNotifications = [...newNotifications, ...storedNotifications].slice(0, CUSTOMER_NOTIFICATION_LIMIT);
        writeCustomerNotifications(uid, nextNotifications);
        setCustomerNotifications(nextNotifications);
        setBookingStatusToast(newNotifications[0]);
        playCustomerNotificationSound();
      },
      (error) => {
        console.warn('Customer booking notifications are unavailable', error);
      }
    );

    return () => unsubscribe();
  }, [isSignedIn, isAdmin, user?.uid]);

  useEffect(() => {
    if (!isSignedIn || isAdmin || !user?.uid) {
      setAppointmentNotifications([]);
      return undefined;
    }

    return listenToCustomerNotifications(
      user.uid,
      setAppointmentNotifications,
      (error) => console.warn('Customer appointment reminders are unavailable', error)
    );
  }, [isSignedIn, isAdmin, user?.uid]);

  useEffect(() => {
    if (!bookingStatusToast) return undefined;
    const timeout = window.setTimeout(() => setBookingStatusToast(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [bookingStatusToast]);

  useEffect(() => {
    if (!bookingPromptKey) return;

    setBannerVisible(true);
    setBannerFading(false);

    const hideTimer = window.setTimeout(() => {
      hideBanner();
    }, 5000);

    return () => {
      window.clearTimeout(hideTimer);
    };
  }, [bookingPromptKey]);

  const goToBooking = (service) => {
    setSelectedService(service || null);

    if (!authReady || !isSignedIn) {
      setPendingBooking(true);
      setShowBookingPrompt(true);
      setBookingPromptKey((prev) => prev + 1);
      return;
    }

    setPendingBooking(false);
    setShowBookingPrompt(false);
    setCurrentPage('booking');
  };

  const handleBookAgain = (booking) => {
    const bookingService = SERVICES.find((serviceItem) => serviceItem.id === booking?.service);
    if (!bookingService) {
      goToBooking(null);
      return;
    }

    const selection = createServiceBookingSelection(
      bookingService,
      booking?.nailQuantity ?? booking?.repairNailsCount ?? 1,
      {
        nailArt: getBookingNailArt(booking, bookingService),
        referenceImageUrl: '',
        skipServiceStep: false,
      }
    );

    goToBooking({
      ...selection,
      openCustomization: serviceSupportsNailArt(bookingService),
    });
  };

  const goToPortfolio = () => {
    setCurrentPage('portfolio');
  };

  const handleNavigate = (page) => {
    setNotificationOpen(false);
    if (isAdmin && page !== 'admin' && page !== 'profile') {
      setCurrentPage('admin');
      return;
    }

    if (page === 'booking') {
      goToBooking(null);
    } else if (page === 'portfolio') {
      goToPortfolio();
    } else if (page === 'profile') {
      setCurrentPage('profile');
    } else {
      setCurrentPage(page);
    }
  };

  const handleToggleNotifications = () => {
    const willOpen = !notificationOpen;
    setNotificationOpen(willOpen);
    if (!willOpen || !user?.uid) return;

    const readNotifications = customerNotifications.map((notification) => ({ ...notification, read: true }));
    setCustomerNotifications(readNotifications);
    writeCustomerNotifications(user.uid, readNotifications);
    const unreadReminderIds = appointmentNotifications
      .filter((notification) => !notification.read)
      .map((notification) => notification.id);
    if (unreadReminderIds.length) {
      setAppointmentNotifications((notifications) => (
        notifications.map((notification) => ({ ...notification, read: true }))
      ));
      markCustomerNotificationsRead(user.uid, unreadReminderIds).catch((error) => {
        console.warn('Unable to mark appointment reminders as read', error);
      });
    }
  };

  const handleSelectNotification = () => {
    setNotificationOpen(false);
    setBookingStatusToast(null);
    setCurrentPage('profile');
  };

  const handleOpenAuth = () => {
    setShowBookingPrompt(false);
    hideBanner();
    setAuthErrorMessage('');
    if (authReady && isSignedIn) {
      setCurrentPage(isAdmin ? 'admin' : 'home');
      return;
    }
    setCurrentPage('admin');
  };

  const handleAuthStart = () => {
    setAuthProcessing(true);
  };

  const handleAuthFinish = () => {
    setAuthProcessing(false);
  };

  const handleSignOut = async () => {
    await logOut();
    setProfileNeedsCompletion(false);
    setCurrentPage('home');
  };

  const handleViewProfile = () => {
    setCurrentPage('profile');
  };

  const handleAuthSuccess = (authenticatedUser) => {
    const destination = getPostAuthDestination({
      email: authenticatedUser?.email,
      adminEmail: import.meta.env.VITE_ADMIN_EMAIL,
      pendingBooking,
    });
    if (authenticatedUser) {
      setUser(authenticatedUser);
      setIsSignedIn(true);
      setAuthReady(true);
    }
    setPendingBooking(false);
    setShowBookingPrompt(false);
    hideBanner();
    setBookingPromptKey(0);
    setAuthProcessing(false);
    setAuthErrorMessage('');
    setCurrentPage(destination);
  };

  useEffect(() => {
    if (!user || !isSignedIn) return undefined;

    let mounted = true;
    const checkStatus = async () => {
      try {
        const accountStatus = await getAccountStatus(user.uid, user.email);
        if (!mounted) return;
        if (accountStatus === 'inactive') {
          await logOut();
          setAuthErrorMessage('Your account has been deactivated. Please contact support.');
          setUser(null);
          setIsSignedIn(false);
          setProfileNeedsCompletion(false);
          setCurrentPage('home');
          setAuthReady(true);
        }
      } catch (error) {
        console.warn('Unable to verify account status', error);
      }
    };

    const intervalId = window.setInterval(checkStatus, 60000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, [user, isSignedIn]);

  const handleProfileUpdated = (profileData) => {
    const fullNameValue = String(profileData?.fullName || profileData?.name || '').trim();
    const phoneValue = String(profileData?.phone || '').trim();
    const addressValue = String(profileData?.address || '').trim();
    const hasFullName = /^[A-Za-zÀ-ÖØ-öø-ÿ' -]{2,60}$/.test(fullNameValue);
    const hasPhone = isValidPhoneNumber(phoneValue);
    const hasAddress = addressValue.length > 0;
    setProfileNeedsCompletion(!(hasFullName && hasPhone && hasAddress));
  };

  const handleToggleUserStatus = async (userId, newStatus, email) => {
    try {
      await updateUserStatus(userId, newStatus, email);
    } catch (error) {
      console.error('Failed to update user status:', error);
    }
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'booking':
        return (
          <BookingPage
            defaultService={selectedService}
            user={user}
            onViewBookings={() => handleNavigate('profile')}
            onBackHome={() => handleNavigate('home')}
            onEditProfile={() => handleNavigate('profile')}
          />
        );
      case 'admin':
        return isAdmin ? (
          <AdminPage
            works={works}
            onAddWork={handleAddWork}
            onDeleteWork={handleDeleteWork}
            onUpdateWork={handleUpdateWork}
            onMoveWork={handleMoveWork}
            onSignOut={handleSignOut}
            onViewProfile={handleViewProfile}
            onToggleUserStatus={handleToggleUserStatus}
          />
        ) : isSignedIn ? (
          <HomePage onBookService={goToBooking} onViewPortfolio={goToPortfolio} works={works} businessInfo={businessInfo} />
        ) : (
          <Login
            onAuthSuccess={handleAuthSuccess}
            onAuthStart={handleAuthStart}
            onAuthFinish={handleAuthFinish}
            pendingBooking={pendingBooking}
            errorMessage={authErrorMessage}
          />
        );
      case 'portfolio':
        return <PortfolioPage works={works} onBookService={goToBooking} />;
      case 'profile':
        return (
          <ProfilePage
            user={user}
            bookings={customerBookings}
            onProfileUpdated={handleProfileUpdated}
            onBookAppointment={() => handleNavigate('booking')}
            onBookAgain={handleBookAgain}
          />
        );
      default:
        return isAdmin ? (
          <AdminPage
            works={works}
            onAddWork={handleAddWork}
            onDeleteWork={handleDeleteWork}
            onUpdateWork={handleUpdateWork}
            onMoveWork={handleMoveWork}
            onSignOut={handleSignOut}
            onViewProfile={handleViewProfile}
            onToggleUserStatus={handleToggleUserStatus}
          />
        ) : (
          <HomePage onBookService={goToBooking} onViewPortfolio={goToPortfolio} works={works} businessInfo={businessInfo} />
        );
    }
  };

  if (!authReady) {
    return (
      <div className="app-shell">
        <div className="auth-loading-overlay" role="status" aria-live="polite">
          <div className="auth-loading-card">
            <div className="auth-loading-spinner" />
            <p>Checking your account…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {authProcessing ? (
        <div className="auth-loading-overlay" role="status" aria-live="polite">
          <div className="auth-loading-card">
            <div className="auth-loading-spinner" />
            <p>Signing you in…</p>
          </div>
        </div>
      ) : null}
      {backendError ? (
        <section className="booking-prompt-banner is-visible" role="alert">
          <div>
            <h3>Database connection issue</h3>
            <p>{backendError}</p>
          </div>
        </section>
      ) : null}
      {bookingStatusToast && isSignedIn && !isAdmin ? (
        <aside className="customer-booking-toast" role="status" aria-live="polite">
          <span className="customer-booking-toast-icon">✓</span>
          <div className="customer-booking-toast-copy">
            <strong>Booking confirmed!</strong>
            <span>{bookingStatusToast.message}</span>
          </div>
          <button type="button" className="customer-booking-toast-view" onClick={handleSelectNotification}>View</button>
          <button type="button" className="customer-booking-toast-close" onClick={() => setBookingStatusToast(null)} aria-label="Dismiss notification">×</button>
        </aside>
      ) : null}
      {currentPage === 'admin' ? null : (
        <Navbar
          currentPage={currentPage}
          onNavigate={handleNavigate}
          isSignedIn={isSignedIn}
          isAdmin={isAdmin}
          user={user}
          showProfileReminder={profileNeedsCompletion}
          notifications={visibleCustomerNotifications}
          notificationOpen={notificationOpen}
          onToggleNotifications={handleToggleNotifications}
          onSelectNotification={handleSelectNotification}
        />
      )}
      {bannerVisible ? (
        <section
          className={`booking-prompt-banner booking-signin-prompt ${bannerFading ? 'is-hiding' : 'is-visible'}`}
          role="status"
          aria-live="polite"
        >
          <div>
            <h3>Please sign in to book</h3>
            <p>Sign in first before you can reserve an appointment.</p>
          </div>
          <button type="button" className="booking-prompt-button" onClick={handleOpenAuth}>
            Sign In
          </button>
        </section>
      ) : null}
      <main>
        <Suspense
          fallback={(
            <div className="page-loading-state" role="status" aria-live="polite">
              <div className="auth-loading-spinner" />
              <span>Loading…</span>
            </div>
          )}
        >
          {renderPage()}
        </Suspense>
      </main>
    </div>
  );
}

export default App;
