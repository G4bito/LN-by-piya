import { useEffect, useMemo, useRef, useState } from 'react';
import {
  claimCustomerLoyaltyReward,
  createLoyaltyRewardId,
  getImageFileValidationError,
  getImageUploadErrorMessage,
  listenToBookings,
  listenToAppointmentChangeRequests,
  listenToAdminNotifications,
  listenToLoyaltyProgram,
  listenToUsers,
  markBookingSeen,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
  saveLoyaltyProgram,
  saveBusinessSettings,
  saveBookingAvailability,
  reviewAppointmentChangeRequest,
  syncConfirmedScheduleSlots,
  updateBookingStatus,
} from '../firebase';
import { getBookingNailArt, getBookingNailQuantity } from '../bookingPricing';
import { formatPeso, SERVICES } from '../constants/services';
import {
  ADMIN_BOOKING_STATUSES,
  ADMIN_NAV_ITEMS,
  ADMIN_PAGE_TITLES,
  APPOINTMENT_FILTERS,
  compareAppointments,
  compareBookingsByCreatedAt,
  findAppointmentConflicts,
  formatBookingCreatedAt,
  getCustomerAppointmentSummary,
  getLocalDateKey,
  isCancelledBooking,
  matchesAppointmentFilter,
  normalizeBookingStatus,
} from '../adminData';
import { DEFAULT_LOYALTY_REWARDS } from '../loyaltyProgram';
import { createRewardDraft } from '../rewardEditor';
import RewardEditorModal from '../components/RewardEditorModal';
import RewardManagementList from '../components/RewardManagementList';
import { formatFileSize } from '../imageUploadConfig';
import {
  DEFAULT_BUSINESS_SETTINGS,
  getBusinessSettingsPatch,
  normalizeBusinessSettings,
  validateBusinessSettingsPatch,
} from '../businessSettings';
import { SCHEDULE_CONFLICT_CODE } from '../scheduling';
import { getDateKeyInTimeZone } from '../businessSettings';
import { getDateAvailability, isAppointmentWithinAvailability } from '../../functions/shared/availability.js';
import BookingAvailabilityManager from '../components/BookingAvailabilityManager';
import SparkBookingPublication from '../components/SparkBookingPublication';
import AdminSettings from '../components/AdminSettings';
import './AdminDashboard.css';

/* ============================================================
   Icons — small inline SVGs, no external dependency required.
   ============================================================ */
const Icon = ({ path, size = 18, strokeWidth = 1.8 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {path}
  </svg>
);

const icons = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  chevronLeft: <path d="M15 18l-6-6 6-6" />,
  chevronRight: <path d="M9 18l6-6-6-6" />,
  search: <><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></>,
  eye: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></>,
  power: <><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.8 0" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></>,
  x: <><path d="M18 6L6 18" /><path d="M6 6l12 12" /></>,
  menu: <><path d="M3 12h18" /><path d="M3 6h18" /><path d="M3 18h18" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></>,
  chevronUp: <path d="M18 15l-6-6-6 6" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  mail: <><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 6l-10 7L2 6" /></>,
  phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />,
  gift: <><path d="M20 12v10H4V12" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" /><path d="M12 7H7.5A2.5 2.5 0 1 1 10 4.5C10 7 12 7 12 7z" /><path d="M12 7h4.5A2.5 2.5 0 1 0 14 4.5C14 7 12 7 12 7z" /></>,
  settings: <><path d="M12 3v2" /><path d="M12 19v2" /><path d="M3 12h2" /><path d="M19 12h2" /><path d="M5.64 5.64l1.41 1.41" /><path d="M16.95 16.95l1.41 1.41" /><path d="M5.64 18.36l1.41-1.41" /><path d="M16.95 7.05l1.41-1.41" /><circle cx="12" cy="12" r="4" /></>,
};

const I = (name, size, sw) => <Icon path={icons[name]} size={size} strokeWidth={sw} />;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getBookingService(booking) {
  return SERVICES.find((service) => service.id === booking?.service);
}

function getBookingServiceLabel(booking) {
  const knownLabel = booking?.serviceName || getBookingService(booking)?.title;
  if (knownLabel) return knownLabel;
  const serviceId = String(booking?.service || '').trim();
  if (!serviceId) return 'Service';
  return serviceId
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function getNailArtSummary(booking) {
  const nailArt = getBookingNailArt(booking, getBookingService(booking));
  return nailArt.enabled
    ? `Nail Art: ${nailArt.quantity} nails × ${formatPeso(nailArt.pricePerNail)} = ${formatPeso(nailArt.total)}`
    : '';
}

function formatCalendarLabel(value) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(value);
}

function buildWeekDates(start) {
  const days = [];
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    days.push(date);
  }
  return days;
}

function formatTimestamp(createdAt) {
  if (!createdAt) return '—';
  try {
    return new Date(createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return createdAt;
  }
}

function formatAdminNotificationTime(createdAt, timeZone = 'Asia/Manila') {
  const timestamp = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt || '');
  if (!Number.isFinite(timestamp)) return 'Recently';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return 'Just now';
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)} min ago`;
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)} hr ago`;
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return formatTimestamp(timestamp);
  }
}

function formatDate(value) {
  if (!value) return '—';
  try {
    const parsedValue = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00` : value;
    return new Date(parsedValue).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return value;
  }
}

function formatTime(value) {
  if (!value) return 'Time to be confirmed';
  const match = String(value).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return value;
  let hour = Number(match[1]);
  const minute = match[2] || '00';
  let period = match[3]?.toUpperCase();
  if (!period) {
    if (match[1].length === 1 && hour > 0 && hour < 9) hour += 12;
    period = hour >= 12 ? 'PM' : 'AM';
  }
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minute} ${period}`;
}

function getReminderDisplay(booking, reminderType) {
  const reminder = booking?.reminders?.[reminderType] || {};
  const sent = reminder.status === 'sent' || booking?.reminders?.[`${reminderType}Sent`] === true;
  const sentAt = reminder.sentAt || booking?.reminders?.[`${reminderType}SentAt`];
  if (sent) {
    const channelNote = reminder.emailStatus === 'skipped' ? 'In-app sent · Email off' : 'Sent';
    return { label: channelNote, tone: 'success', detail: sentAt ? formatTimestamp(sentAt) : '' };
  }
  if (reminder.status === 'failed') {
    const retryWindowOpen = Number(reminder.dueAt || 0) + (90 * 60 * 1000) >= Date.now();
    return {
      label: Number(reminder.attemptCount || 0) >= 3 || !retryWindowOpen ? 'Failed' : 'Retry pending',
      tone: 'warning',
      detail: `${Number(reminder.attemptCount || 0)} of 3 attempts`,
    };
  }
  if (reminder.status === 'processing') return { label: 'Sending', tone: 'warning', detail: '' };
  if (reminder.status === 'skipped') return { label: 'Skipped', tone: 'muted', detail: '' };
  if (normalizeBookingStatus(booking?.status) !== 'Confirmed') {
    return { label: 'Not scheduled', tone: 'muted', detail: 'Appointment is not confirmed' };
  }
  return { label: 'Pending', tone: 'muted', detail: 'Waiting for reminder window' };
}

function getBookingCustomerName(booking) {
  return booking?.customerName || booking?.name || 'Guest';
}

function getBookingCustomerPhone(booking) {
  return booking?.customerPhone || booking?.phone || '';
}

function getBookingTotal(booking) {
  return Number(booking?.estimatedTotal ?? booking?.totalPrice ?? booking?.baseTotal ?? booking?.basePrice ?? 0) || 0;
}

function getAdminNotificationContent(notification, bookings, requests) {
  const booking = bookings.find((item) => item.id === notification?.bookingId);
  const request = requests.find((item) => item.id === notification?.requestId || item.id === notification?.targetId);
  const customerName = getBookingCustomerName(booking);
  if (notification?.type === 'new_booking') {
    return {
      title: 'New Booking',
      message: `${customerName} booked ${getBookingServiceLabel(booking)} for ${formatDate(booking?.date)} at ${formatTime(booking?.time)}.`,
      action: 'View appointment',
    };
  }
  if (notification?.type === 'cancellation_request') {
    return {
      title: 'Cancellation Request',
      message: `${customerName} requested to cancel ${getBookingServiceLabel(booking)} on ${formatDate(booking?.date)} at ${formatTime(booking?.time)}.`,
      action: 'Review request',
    };
  }
  if (notification?.type === 'reschedule_request') {
    const requestedSchedule = request
      ? ` to ${formatDate(request.requestedDate)} at ${formatTime(request.requestedTime)}`
      : '';
    return {
      title: 'Reschedule Request',
      message: `${customerName} requested to move ${getBookingServiceLabel(booking)}${requestedSchedule}.`,
      action: 'Review request',
    };
  }
  return {
    title: notification?.title || 'Admin update',
    message: notification?.message || 'An operational update is ready for review.',
    action: notification?.bookingId ? 'View appointment' : 'View details',
  };
}

function getPreferenceRows(user) {
  const preferences = user?.nailPreferences && typeof user.nailPreferences === 'object' ? user.nailPreferences : {};
  return [
    ['Shape', preferences.shape],
    ['Length', preferences.length],
    ['Finish', preferences.finish],
    ['Favorite color', preferences.favoriteColor || preferences.color],
    ['Favorite service', preferences.favoriteService || preferences.service],
    ['Preferred nail tech', preferences.preferredTechnician || preferences.technician],
    ['Notes', preferences.notes],
  ].filter(([, preferenceValue]) => String(preferenceValue || '').trim());
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function cx(...args) {
  return args.filter(Boolean).join(' ');
}

const PAGE_SIZE = 8;
const PORTFOLIO_STYLE_OPTIONS = ['French Tips', 'Embosed', 'Ombre', 'Chrome', 'Floral', 'Minimalist', 'Plain', 'Hand Paint', 'Glitter', 'Cat Eye'];
const NAIL_SHAPE_OPTIONS = ['Round', 'Oval', 'Almond', 'Square', 'Coffin', 'Stiletto'];
const NAIL_LENGTH_OPTIONS = ['Short', 'Medium', 'Long', 'Extra Long'];
const NAIL_FINISH_OPTIONS = ['Glossy', 'Matte', 'Chrome', 'Glitter', 'Cat Eye'];
function buildPortfolioOptions(defaultOptions, works, field, currentValue) {
  const options = new Set(defaultOptions);
  works.forEach((work) => {
    const value = String(work?.[field] || '').trim();
    if (value) options.add(value);
  });
  if (String(currentValue || '').trim()) options.add(String(currentValue).trim());
  return Array.from(options);
}

function AdminPage({
  works = [],
  onAddWork,
  onDeleteWork,
  onUpdateWork,
  onMoveWork,
  onSignOut,
  users: usersProp,
  onViewUser,
  onEditUser,
  onToggleUserStatus,
  onDeleteUser,
  businessSettings: businessSettingsProp,
  businessSettingsLoading = false,
  businessSettingsError = '',
}) {
  /* ---------------- shell / navigation state ---------------- */
  const [activeTab, setActiveTab] = useState('overview');
  const [availabilityDate, setAvailabilityDate] = useState(() => getDateKeyInTimeZone(new Date(), businessSettingsProp?.timezone));
  const previousSettingsRef = useRef(normalizeBusinessSettings(businessSettingsProp));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  /* ---------------- bookings state (existing logic) ---------------- */
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bookingStatusFilter, setBookingStatusFilter] = useState('All');
  const [selectedAppointmentDate, setSelectedAppointmentDate] = useState('');
  const [appointmentSearch, setAppointmentSearch] = useState('');
  const [appointmentFromDate, setAppointmentFromDate] = useState('');
  const [appointmentToDate, setAppointmentToDate] = useState('');
  const [appointmentSort, setAppointmentSort] = useState('nearest');
  const [statusUpdatingId, setStatusUpdatingId] = useState('');
  const [bookingActionError, setBookingActionError] = useState('');
  const [appointmentChangeRequests, setAppointmentChangeRequests] = useState([]);
  const [requestUpdatingId, setRequestUpdatingId] = useState('');
  const [requestReviewDialog, setRequestReviewDialog] = useState(null);
  const [adminNotifications, setAdminNotifications] = useState([]);
  const [adminNotificationOpen, setAdminNotificationOpen] = useState(false);
  const [adminNotificationExpanded, setAdminNotificationExpanded] = useState(false);
  const [adminNotificationError, setAdminNotificationError] = useState('');
  const [referencePreviewUrl, setReferencePreviewUrl] = useState('');
  const [notificationBooking, setNotificationBooking] = useState(null);
  const [backendError, setBackendError] = useState('');
  const [notificationVisible, setNotificationVisible] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedBookingId, setSelectedBookingId] = useState(null);
  const previousBookingIdsRef = useRef(new Set());
  const hasLoadedBookingsRef = useRef(false);
  const soundEnabledRef = useRef(soundEnabled);
  const scheduleSignatureRef = useRef(null);
  const previousRequestIdsRef = useRef(new Set());
  const hasLoadedRequestsRef = useRef(false);
  const adminNotificationRef = useRef(null);
  const adminBookings = bookings;

  const visibleBookings = adminBookings;
  const pendingAppointmentRequests = appointmentChangeRequests.filter((request) => request.status === 'Pending');
  const pendingRequestByBookingId = useMemo(() => new Map(
    pendingAppointmentRequests.map((request) => [request.bookingId, request])
  ), [pendingAppointmentRequests]);
  const unreadAdminNotificationCount = adminNotifications.filter((notification) => !notification.read).length;
  const displayedAdminNotifications = adminNotificationExpanded ? adminNotifications : adminNotifications.slice(0, 8);

  /* ---------------- portfolio form state (existing logic) ---------------- */
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Gel Manicure');
  const [style, setStyle] = useState('');
  const [description, setDescription] = useState('');
  const [shape, setShape] = useState('');
  const [length, setLength] = useState('');
  const [finish, setFinish] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [previewSrc, setPreviewSrc] = useState('');
  const [editId, setEditId] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [deletingWorkId, setDeletingWorkId] = useState(null);
  const portfolioFileInputRef = useRef(null);

  /* ---------------- user management state ---------------- */
  const [localUsers, setLocalUsers] = useState(usersProp || []);
  const [userLoading, setUserLoading] = useState(!usersProp);
  const [userSearch, setUserSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortKey, setSortKey] = useState('fullName');
  const [sortDir, setSortDir] = useState('asc');
  const [userPage, setUserPage] = useState(1);
  const [viewingUser, setViewingUser] = useState(null);
  const [editingUser, setEditingUser] = useState(null);
  const [editDraft, setEditDraft] = useState({ fullName: '', email: '', phone: '' });
  const [deletingUser, setDeletingUser] = useState(null);
  const [loyaltyProgram, setLoyaltyProgram] = useState(null);
  const [rewardDraft, setRewardDraft] = useState(null);
  const [loyaltySaving, setLoyaltySaving] = useState(false);
  const [loyaltySaveStatus, setLoyaltySaveStatus] = useState('');
  const [rewardSaveError, setRewardSaveError] = useState('');
  const [loyaltyLoading, setLoyaltyLoading] = useState(true);
  const [loyaltyLoadError, setLoyaltyLoadError] = useState('');
  const rewardActionInFlightRef = useRef(false);
  const [claimingRewardUserId, setClaimingRewardUserId] = useState('');
  const [rewardActionStatus, setRewardActionStatus] = useState('');
  const [businessSettings, setBusinessSettings] = useState(() => normalizeBusinessSettings(businessSettingsProp));
  const [settingsDraft, setSettingsDraft] = useState(() => normalizeBusinessSettings(businessSettingsProp));
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState('');
  const rewardClaimInFlightRef = useRef(false);
  const salonTimeZone = businessSettings.timezone || DEFAULT_BUSINESS_SETTINGS.timezone;

  useEffect(() => {
    if (usersProp) {
      setLocalUsers(usersProp);
      setUserLoading(false);
    }
  }, [usersProp]);

  useEffect(() => {
    const unsubscribe = listenToLoyaltyProgram(
      (program) => {
        setLoyaltyProgram(program);
        setLoyaltyLoading(false);
        setLoyaltyLoadError('');
      },
      () => {
        setLoyaltyLoading(false);
        setLoyaltyLoadError('Rewards could not be loaded. Check your connection and reload.');
      }
    );
    return () => unsubscribe();
  }, []);

  useEffect(() => listenToAppointmentChangeRequests(
    (requests) => {
      setAppointmentChangeRequests(requests);
      if (hasLoadedRequestsRef.current) {
        const newRequest = requests.find((request) => request.status === 'Pending' && request.seenByAdmin === false && !previousRequestIdsRef.current.has(`${request.id}:${request.createdAt}`));
        if (newRequest) {
          setNotificationBooking({ ...newRequest, isChangeRequest: true });
          setNotificationVisible(true);
        }
      }
      previousRequestIdsRef.current = new Set(requests.map((request) => `${request.id}:${request.createdAt}`));
      hasLoadedRequestsRef.current = true;
    },
    (error) => {
      console.warn('Unable to listen for appointment change requests', error);
      setBookingActionError('Appointment change requests could not be loaded.');
    }
  ), []);

  useEffect(() => listenToAdminNotifications(
    (notifications) => {
      setAdminNotifications(notifications);
      setAdminNotificationError('');
    },
    (error) => {
      console.warn('Unable to load Admin notifications.', error);
      setAdminNotificationError('Notifications could not be loaded right now.');
    }
  ), []);

  useEffect(() => {
    if (!adminNotificationOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!adminNotificationRef.current?.contains(event.target)) setAdminNotificationOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setAdminNotificationOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [adminNotificationOpen]);

  useEffect(() => {
    const nextSettings = normalizeBusinessSettings(businessSettingsProp);
    const previousSettings = previousSettingsRef.current;
    setBusinessSettings(nextSettings);
    setSettingsDraft((current) => ({ ...nextSettings, ...getBusinessSettingsPatch(previousSettings, current) }));
    previousSettingsRef.current = nextSettings;
  }, [businessSettingsProp]);

  useEffect(() => {
    if (usersProp) return undefined;

    if (activeTab !== 'overview' && activeTab !== 'users' && activeTab !== 'rewards') {
      return undefined;
    }

    let mounted = true;
    setUserLoading(true);

    const unsubscribe = listenToUsers((users) => {
      if (!mounted) return;
      setLocalUsers(users);
      setUserLoading(false);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [activeTab, usersProp]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const today = useMemo(() => new Date(`${getDateKeyInTimeZone(new Date(), salonTimeZone)}T12:00:00`), [salonTimeZone]);
  const todayKey = getLocalDateKey(today);
  const weekDates = useMemo(() => buildWeekDates(today), [today]);
  const weekKeys = useMemo(() => weekDates.map((date) => getLocalDateKey(date)), [weekDates]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const playNotificationSound = () => {
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.value = 0.12;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.18);
        oscillator.onended = () => context.close();
      } catch (error) {
        console.warn('Notification sound failed:', error);
      }
    };

    const unsubscribe = listenToBookings(
      (data) => {
        if (!mounted) return;
        setBookings(data);
        setBackendError('');
        const scheduleSignature = data
          .filter((booking) => ['pending confirmation', 'confirmed', 'completed', 'cancelled', 'canceled', 'declined', 'no show', 'no-show'].includes(String(booking.status || '').trim().toLowerCase()))
          .map((booking) => `${booking.id}:${booking.status}:${booking.date}:${booking.time}:${booking.service}`)
          .sort()
          .join('|');
        if (scheduleSignatureRef.current !== scheduleSignature) {
          scheduleSignatureRef.current = scheduleSignature;
          syncConfirmedScheduleSlots(data).catch((error) => {
            console.warn('Unable to synchronize confirmed schedule slots.', error);
          });
        }

        const filteredData = data;

        if (hasLoadedBookingsRef.current) {
          const prevIds = previousBookingIdsRef.current;
          const newBookings = filteredData.filter((booking) => !prevIds.has(booking.id) && booking.seenByAdmin === false);
          if (newBookings.length > 0) {
            const latestNewBooking = newBookings[0];
            setNotificationBooking(latestNewBooking);
            setNotificationVisible(true);
            if (soundEnabledRef.current) {
              playNotificationSound();
            }
          }
        }

        previousBookingIdsRef.current = new Set(filteredData.map((booking) => booking.id));
        hasLoadedBookingsRef.current = true;
        setLoading(false);
      },
      (error) => {
        console.warn('Unable to listen for booking updates', error);
        setBackendError('Unable to synchronize bookings with the database. Please check your Firebase settings.');
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!notificationVisible) return undefined;

    const timeout = window.setTimeout(() => {
      setNotificationVisible(false);
    }, 7000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [notificationVisible]);

  useEffect(() => {
    if (imageFile) {
      const objectUrl = URL.createObjectURL(imageFile);
      setPreviewSrc(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    return undefined;
  }, [imageFile]);

  const bookingsToday = useMemo(
    () => visibleBookings
      .filter((booking) => booking.date === todayKey && !isCancelledBooking(booking))
      .sort(compareAppointments),
    [visibleBookings, todayKey]
  );

  const bookingsThisWeek = useMemo(
    () => visibleBookings.filter((booking) => weekKeys.includes(booking.date) && !isCancelledBooking(booking)),
    [visibleBookings, weekKeys]
  );

  const weeklyCalendar = useMemo(
    () => weekDates.map((date) => {
      const key = getLocalDateKey(date);
      const count = visibleBookings.filter((booking) => booking.date === key && !isCancelledBooking(booking)).length;
      return { key, label: formatCalendarLabel(date), count, availability: getDateAvailability(key, businessSettings, visibleBookings, new Date()) };
    }),
    [visibleBookings, weekDates, businessSettings]
  );

  const upcomingBookings = visibleBookings.filter((booking) => (
    booking.date >= todayKey && ['Pending Confirmation', 'Confirmed'].includes(normalizeBookingStatus(booking.status))
  )).length;
  const topServices = useMemo(() => {
    const serviceCounts = visibleBookings.filter((booking) => !isCancelledBooking(booking)).reduce((acc, booking) => {
      const service = getBookingServiceLabel(booking);
      acc[service] = (acc[service] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(serviceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  }, [visibleBookings]);

  const appointmentConflicts = useMemo(() => findAppointmentConflicts(visibleBookings), [visibleBookings]);
  const filteredAppointments = useMemo(() => {
    const term = appointmentSearch.trim().toLowerCase();
    const filtered = visibleBookings.filter((booking) => {
      const matchesBaseFilter = bookingStatusFilter === 'Cancellation Requests'
        ? pendingRequestByBookingId.get(booking.id)?.type === 'cancellation'
        : matchesAppointmentFilter(booking, bookingStatusFilter, todayKey, selectedAppointmentDate);
      const matchesSearch = !term || [
        getBookingCustomerName(booking),
        getBookingCustomerPhone(booking),
        booking.email,
        booking.customerEmail,
        getBookingServiceLabel(booking),
      ].some((value) => String(value || '').toLowerCase().includes(term));
      const matchesFrom = !appointmentFromDate || String(booking.date || '') >= appointmentFromDate;
      const matchesTo = !appointmentToDate || String(booking.date || '') <= appointmentToDate;
      return matchesBaseFilter && matchesSearch && matchesFrom && matchesTo;
    });
    return filtered.sort((left, right) => {
      if (appointmentSort === 'newest') return compareBookingsByCreatedAt(left, right, 'desc');
      if (appointmentSort === 'oldest') return compareBookingsByCreatedAt(left, right, 'asc');
      return compareAppointments(left, right);
    });
  }, [appointmentFromDate, appointmentSearch, appointmentSort, appointmentToDate, bookingStatusFilter, pendingRequestByBookingId, selectedAppointmentDate, todayKey, visibleBookings]);
  const selectedBooking = useMemo(
    () => visibleBookings.find((booking) => booking.id === selectedBookingId) || null,
    [selectedBookingId, visibleBookings]
  );
  const selectedBookingRequest = useMemo(() => appointmentChangeRequests
    .filter((request) => request.bookingId === selectedBookingId)
    .sort((left, right) => Number(right.createdAt || 0) - Number(left.createdAt || 0))[0] || null,
  [appointmentChangeRequests, selectedBookingId]);
  const selectedBookingCustomer = useMemo(
    () => localUsers.find((customer) => customer.id === selectedBooking?.uid)
      || localUsers.find((customer) => customer.email && customer.email === selectedBooking?.email)
      || null,
    [localUsers, selectedBooking]
  );
  const customerSummaryById = useMemo(() => new Map(localUsers.map((customer) => [
    customer.id,
    getCustomerAppointmentSummary(customer, visibleBookings, todayKey, loyaltyProgram),
  ])), [localUsers, loyaltyProgram, todayKey, visibleBookings]);
  const customerSummaries = Array.from(customerSummaryById.values());
  const loyaltyMembers = customerSummaries.filter((summary) => summary.completedVisits > 0).length;
  const availableRewards = customerSummaries.reduce((total, summary) => total + summary.availableRewards, 0);
  const customersWithAvailableRewards = useMemo(() => localUsers
    .map((customer) => ({ customer, summary: customerSummaryById.get(customer.id) }))
    .filter(({ summary }) => summary?.availableRewards > 0)
    .sort((left, right) => right.summary.availableRewards - left.summary.availableRewards
      || left.customer.fullName.localeCompare(right.customer.fullName)), [customerSummaryById, localUsers]);
  const recentRewardClaims = useMemo(() => localUsers
    .flatMap((customer) => (customerSummaryById.get(customer.id)?.rewardHistory || []).map((reward) => ({
      customer,
      reward,
    })))
    .sort((left, right) => String(right.reward.claimedAt).localeCompare(String(left.reward.claimedAt)))
    .slice(0, 8), [customerSummaryById, localUsers]);
  const totalRewardsClaimed = customerSummaries.reduce((total, summary) => total + summary.claimedRewards, 0);

  /* ---------------- portfolio handlers (existing logic) ---------------- */
  const handleFileChange = (e) => {
    const file = e.target.files?.[0] || null;
    const validationError = file ? getImageFileValidationError(file, 'portfolio') : '';
    if (validationError) {
      setImageFile(null);
      setPreviewSrc('');
      setUploadError(validationError);
      setUploadSuccess('');
      setUploadProgress(0);
      setIsSaving(false);
      e.target.value = '';
      return;
    }
    setUploadError('');
    setUploadSuccess('');
    setUploadProgress(0);
    setImageFile(file);
  };

  const resetPortfolioForm = () => {
    setEditId(null);
    setTitle('');
    setCategory('Gel Manicure');
    setStyle('');
    setDescription('');
    setShape('');
    setLength('');
    setFinish('');
    setImageFile(null);
    setPreviewSrc('');
    setUploadProgress(0);
    setUploadError('');
    if (portfolioFileInputRef.current) portfolioFileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const image = imageFile || previewSrc;
    if (!title.trim() || !category.trim() || !image) {
      setUploadError('Please add a title, category, and photo file.');
      return;
    }

    const itemPayload = {
      id: editId || Date.now(),
      title: title.trim(),
      category: category.trim(),
      style: style.trim(),
      description: description.trim(),
      shape: shape.trim(),
      length: length.trim(),
      finish: finish.trim(),
      // include both the preview (string) and the raw File (if any)
      image: typeof previewSrc === 'string' ? previewSrc : '',
      imageFile: imageFile || null,
    };

    setIsSaving(true);
    setUploadProgress(0);
    setUploadError('');
    setUploadSuccess('');
    const wasEditing = Boolean(editId);
    try {
      if (editId) {
        await onUpdateWork(editId, itemPayload, (p) => setUploadProgress(p));
      } else {
        await onAddWork(itemPayload, (p) => setUploadProgress(p));
      }
      resetPortfolioForm();
      setUploadSuccess(wasEditing ? 'Portfolio image updated successfully.' : 'Portfolio image added successfully.');
    } catch (err) {
      console.error('Portfolio save failed:', {
        code: err?.code || 'unknown',
        status: err?.status_ || err?.status || null,
      });
      setUploadError(getImageUploadErrorMessage(err));
      setUploadProgress(0);
      if (portfolioFileInputRef.current) portfolioFileInputRef.current.value = '';
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditWork = (work) => {
    setEditId(work.id);
    setTitle(work.title);
    setCategory(work.category);
    setStyle(work.style || '');
    setDescription(work.description || '');
    setShape(work.shape || '');
    setLength(work.length || '');
    setFinish(work.finish || '');
    setPreviewSrc(work.image || '');
    setImageFile(null);
    setUploadError('');
    setUploadSuccess('');
  };

  const handleDeletePortfolioWork = async (work) => {
    if (deletingWorkId != null) return;
    setDeletingWorkId(work.id);
    setUploadError('');
    setUploadSuccess('');
    try {
      await onDeleteWork(work.id);
      if (String(editId) === String(work.id)) resetPortfolioForm();
      setUploadSuccess('Portfolio image deleted successfully.');
    } catch (error) {
      console.error('Portfolio delete failed:', error);
      setUploadError('The portfolio image could not be deleted. Please try again.');
    } finally {
      setDeletingWorkId(null);
    }
  };

  const handleToggleWorkVisibility = async (work) => {
    try {
      await onUpdateWork?.(work.id, { visible: work.visible === false });
    } catch (error) {
      console.error('Failed to update portfolio visibility:', error);
    }
  };

  const categoryOptions = useMemo(() => {
    const defaultCategories = ['Gel Manicure', 'BIAB / Structured Gel', 'Soft Gel Extensions'];
    const derived = new Set(defaultCategories);
    works.forEach((work) => {
      if (work?.category) derived.add(work.category);
    });
    return Array.from(derived);
  }, [works]);
  const styleOptions = useMemo(
    () => buildPortfolioOptions(PORTFOLIO_STYLE_OPTIONS, works, 'style', style),
    [style, works]
  );
  const shapeOptions = useMemo(
    () => buildPortfolioOptions(NAIL_SHAPE_OPTIONS, works, 'shape', shape),
    [shape, works]
  );
  const lengthOptions = useMemo(
    () => buildPortfolioOptions(NAIL_LENGTH_OPTIONS, works, 'length', length),
    [length, works]
  );
  const finishOptions = useMemo(
    () => buildPortfolioOptions(NAIL_FINISH_OPTIONS, works, 'finish', finish),
    [finish, works]
  );

  const handleEnableSound = () => {
    setSoundEnabled(true);
    setNotificationVisible(false);
  };

  const handleNotificationClick = async () => {
    if (!notificationBooking) return;
    setActiveTab('bookings');
    setNotificationVisible(false);
    if (notificationBooking.isChangeRequest) {
      setBookingStatusFilter(notificationBooking.type === 'cancellation' ? 'Cancellation Requests' : 'All');
      setSelectedBookingId(notificationBooking.bookingId);
      await markAdminNotificationRead(notificationBooking.id).catch((error) => {
        console.warn('Unable to mark the request notification as read.', error);
      });
      return;
    }
    setSelectedBookingId(notificationBooking.id);
    try {
      await markBookingSeen(notificationBooking.id);
    } catch (error) {
      console.error('Failed to mark booking seen:', error);
    }
  };

  const handleBookingAction = async (bookingId, nextStatus) => {
    setStatusUpdatingId(bookingId);
    setBookingActionError('');
    try {
      const result = await updateBookingStatus(bookingId, nextStatus);
      setBookings((prev) => prev.map((booking) => (
        booking.id === bookingId
          ? {
            ...booking,
            status: nextStatus,
            seenByAdmin: true,
            rewardGiven: result?.rewardGiven ?? booking.rewardGiven,
            confirmedAt: result?.confirmedAt || booking.confirmedAt,
            updatedAt: new Date().toISOString(),
          }
          : booking
      )));
      if (nextStatus !== 'Pending Confirmation') {
      }
    } catch (error) {
      console.error(`Failed to update booking status to ${nextStatus}:`, error);
      const safeMessage = error?.code === SCHEDULE_CONFLICT_CODE
        ? error.message
        : String(error?.message || '').startsWith('The appointment')
          ? error.message
          : 'The booking status could not be updated. Please check your connection and try again.';
      setBookingActionError(safeMessage);
    } finally {
      setStatusUpdatingId('');
    }
  };

  const handleOpenBooking = async (booking) => {
    if (!booking) return;
    setSelectedBookingId(booking.id);
    setBookingActionError('');
    if (booking.seenByAdmin === false) {
      try {
        await markBookingSeen(booking.id);
      } catch (error) {
        console.warn('Unable to mark booking as seen.', error);
      }
    }
  };

  const handleCalendarDayClick = (dateKey) => {
    setAvailabilityDate(dateKey);
    setActiveTab('availability');
    requestAnimationFrame(() => document.getElementById('booking-availability')?.scrollIntoView({ block: 'start' }));
  };

  const handleStatCardClick = (label) => {
    const routes = {
      'Total customers': 'users',
      'Upcoming appointments': 'bookings',
      'Pending requests': 'bookings',
      'Rewards available': 'rewards',
      "Today's appointments": 'bookings',
      '7-day bookings': 'bookings',
      'Completed visits': 'bookings',
      'Loyalty members': 'users',
    };
    const nextTab = routes[label];
    if (!nextTab) return;
    setActiveTab(nextTab);
    setSelectedAppointmentDate('');
    if (label === 'Upcoming appointments') setBookingStatusFilter('Upcoming');
    if (label === 'Pending requests') setBookingStatusFilter('Pending');
    if (label === "Today's appointments") setBookingStatusFilter('Today');
  };

  const handleSaveSettings = async (event) => {
    event.preventDefault();
    if (settingsSaving) return;
    const validationErrors = validateBusinessSettingsPatch(settingsDraft);
    if (validationErrors.length) {
      setSettingsStatus(validationErrors[0]);
      return;
    }
    const nextSettings = normalizeBusinessSettings(settingsDraft);
    const changedSettings = getBusinessSettingsPatch(businessSettings, nextSettings);
    if (!Object.keys(changedSettings).length) {
      setSettingsStatus('No unsaved changes.');
      return;
    }
    setSettingsSaving(true);
    setSettingsStatus('Saving business settings...');
    try {
      await saveBusinessSettings(changedSettings);
      const savedSettings = normalizeBusinessSettings({ ...businessSettings, ...changedSettings });
      setBusinessSettings(savedSettings);
      setSettingsDraft(savedSettings);
      setSettingsStatus('Saved ✓');
    } catch (error) {
      setSettingsStatus(error?.message || 'Business settings could not be saved.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleAdminNotificationClick = async (notification) => {
    if (!notification) return;
    setAdminNotificationOpen(false);
    try {
      await markAdminNotificationRead(notification.id);
    } catch (error) {
      console.warn('Unable to mark the Admin notification as read.', error);
    }
    if (notification.bookingId) {
      setActiveTab('bookings');
      setSelectedAppointmentDate('');
      setBookingStatusFilter(notification.type === 'cancellation_request' ? 'Cancellation Requests' : 'All');
      setSelectedBookingId(notification.bookingId);
      const booking = bookings.find((item) => item.id === notification.bookingId);
      if (booking?.seenByAdmin === false) {
        markBookingSeen(booking.id).catch((error) => console.warn('Unable to mark the booking as seen.', error));
      }
    }
  };

  const handleMarkAllAdminNotificationsRead = async () => {
    const unreadIds = adminNotifications.filter((notification) => !notification.read).map((notification) => notification.id);
    if (!unreadIds.length) return;
    try {
      await markAllAdminNotificationsRead(unreadIds);
    } catch (error) {
      console.warn('Unable to mark all Admin notifications as read.', error);
      setAdminNotificationError('Notifications could not be updated. Please try again.');
    }
  };

  const handleAppointmentRequestDecision = async () => {
    const request = requestReviewDialog?.request;
    const decision = requestReviewDialog?.decision;
    if (!request || !decision) return;
    if (requestUpdatingId) return;
    const action = decision === 'Approved' ? 'approve' : 'decline';
    setRequestUpdatingId(request.id);
    setBookingActionError('');
    try {
      await reviewAppointmentChangeRequest(request.id, decision, requestReviewDialog.adminReason || '');
      setRequestReviewDialog(null);
    } catch (error) {
      setBookingActionError(error?.message || `The ${request.type} request could not be ${action}d.`);
    } finally {
      setRequestUpdatingId('');
    }
  };

  const openRequestReviewDialog = (request, decision) => {
    setBookingActionError('');
    setRequestReviewDialog({ request, decision, adminReason: '' });
  };

  const updateSettingsField = (field, value) => {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
    setSettingsStatus('');
  };

  const updateWeeklyHours = (field, day, key, value) => {
    setSettingsDraft((current) => ({
      ...current,
      [field]: {
        ...current[field],
        [day]: { ...current[field][day], [key]: value },
      },
    }));
    setSettingsStatus('');
  };

  const handleNailArtEligibilityChange = (serviceId, enabled) => {
    if (!enabled && settingsDraft.nailArtEligibleServiceIds.length === 1) {
      setSettingsStatus('Keep at least one service eligible for Nail Art.');
      return;
    }
    updateSettingsField(
      'nailArtEligibleServiceIds',
      enabled
        ? [...new Set([...settingsDraft.nailArtEligibleServiceIds, serviceId])]
        : settingsDraft.nailArtEligibleServiceIds.filter((id) => id !== serviceId)
    );
  };

  const handleCancelEdit = () => {
    resetPortfolioForm();
  };

  /* ---------------- user management handlers ---------------- */
  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    let list = localUsers.filter((user) => {
      const matchesTerm = !term
        || user.fullName?.toLowerCase().includes(term)
        || user.email?.toLowerCase().includes(term)
        || (user.phone || '').toLowerCase().includes(term);
      const matchesStatus = statusFilter === 'all' || user.status === statusFilter;
      return matchesTerm && matchesStatus;
    });

    list = [...list].sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === 'dateRegistered' || sortKey === 'lastLogin') {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      } else {
        av = (av || '').toString().toLowerCase();
        bv = (bv || '').toString().toLowerCase();
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [localUsers, userSearch, statusFilter, sortKey, sortDir]);

  const totalUserPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const pagedUsers = useMemo(
    () => filteredUsers.slice((userPage - 1) * PAGE_SIZE, userPage * PAGE_SIZE),
    [filteredUsers, userPage]
  );

  useEffect(() => {
    setUserPage(1);
  }, [userSearch, statusFilter]);

  useEffect(() => {
    if (userPage > totalUserPages) setUserPage(totalUserPages);
  }, [totalUserPages, userPage]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleViewUser = (user) => {
    setRewardActionStatus('');
    setViewingUser(user);
    onViewUser?.(user);
  };

  const handleOpenEditUser = (user) => {
    setEditingUser(user);
    setEditDraft({ fullName: user.fullName, email: user.email, phone: user.phone || '', address: user.address || '' });
  };

  const handleSaveEditUser = (e) => {
    e.preventDefault();
    if (!editingUser) return;
    const updated = { ...editingUser, ...editDraft };
    if (onEditUser) {
      onEditUser(editingUser.id, editDraft);
    } else {
      setLocalUsers((prev) => prev.map((u) => (u.id === editingUser.id ? updated : u)));
    }
    setEditingUser(null);
  };

  const handleToggleStatus = async (user) => {
    const nextStatus = user.status === 'active' ? 'inactive' : 'active';
    if (onToggleUserStatus) {
      try {
        await onToggleUserStatus(user.id, nextStatus, user.email);
        setLocalUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: nextStatus } : u)));
      } catch (error) {
        console.error('Failed to toggle user status:', error);
      }
    } else {
      setLocalUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: nextStatus } : u)));
    }
  };

  const handleConfirmDelete = () => {
    if (!deletingUser) return;
    if (onDeleteUser) {
      onDeleteUser(deletingUser.id);
    } else {
      setLocalUsers((prev) => prev.filter((u) => u.id !== deletingUser.id));
    }
    setDeletingUser(null);
  };

  const updateRewardDraft = (field, value) => {
    setLoyaltySaveStatus('');
    setRewardSaveError('');
    setRewardDraft((current) => current ? { ...current, [field]: value } : current);
  };

  const handleEditReward = (reward) => {
    setLoyaltySaveStatus('');
    setRewardSaveError('');
    setRewardDraft(createRewardDraft(reward));
  };

  const handleAddReward = () => {
    setLoyaltySaveStatus('');
    setRewardSaveError('');
    setRewardDraft(createRewardDraft());
  };

  const handleSaveReward = async (event) => {
    event.preventDefault();
    if (rewardActionInFlightRef.current || !rewardDraft) return false;

    rewardActionInFlightRef.current = true;
    setLoyaltySaving(true);
    setRewardSaveError('');
    setLoyaltySaveStatus('Saving reward milestone...');
    try {
      const rewardId = rewardDraft.id || createLoyaltyRewardId();
      const currentRewards = loyaltyProgram?.rewards || [];
      const nextReward = {
        ...rewardDraft,
        id: rewardId,
        sortOrder: rewardDraft.sortOrder ?? currentRewards.length + 1,
      };
      const nextRewards = currentRewards.some((reward) => reward.id === rewardId)
        ? currentRewards.map((reward) => (reward.id === rewardId ? nextReward : reward))
        : [...currentRewards, nextReward];
      const savedProgram = await saveLoyaltyProgram({
        active: true,
        enabled: true,
        rewards: nextRewards,
      });
      setLoyaltyProgram(savedProgram);
      setLoyaltySaveStatus('Reward milestone saved. Customer profiles update automatically.');
      return true;
    } catch (error) {
      console.error('Failed to save loyalty reward', error);
      setLoyaltySaveStatus(error?.message || 'The reward milestone could not be saved.');
      setRewardSaveError(error?.message || 'The reward milestone could not be saved.');
      return false;
    } finally {
      rewardActionInFlightRef.current = false;
      setLoyaltySaving(false);
    }
  };

  const handleToggleReward = async (reward) => {
    if (rewardActionInFlightRef.current) return;
    const action = reward.active ? 'Deactivate' : 'Activate';
    if (!window.confirm(`${action} "${reward.name}"? This may change customer reward eligibility. Existing completed visits and reward history will be preserved.`)) return;
    rewardActionInFlightRef.current = true;
    setLoyaltySaving(true);
    setLoyaltySaveStatus('Updating reward status...');
    try {
      const nextRewards = (loyaltyProgram?.rewards || []).map((item) => (
        item.id === reward.id ? { ...item, active: !item.active } : item
      ));
      const savedProgram = await saveLoyaltyProgram({ active: true, enabled: true, rewards: nextRewards });
      setLoyaltyProgram(savedProgram);
      setLoyaltySaveStatus(`${reward.name} is now ${reward.active ? 'inactive' : 'active'}.`);
    } catch (error) {
      setLoyaltySaveStatus(error?.message || 'The reward status could not be updated.');
    } finally {
      rewardActionInFlightRef.current = false;
      setLoyaltySaving(false);
    }
  };

  const handleInstallSuggestedRewards = async () => {
    if (rewardActionInFlightRef.current) return;
    rewardActionInFlightRef.current = true;
    setLoyaltySaving(true);
    setLoyaltySaveStatus('Creating suggested reward milestones...');
    try {
      const savedProgram = await saveLoyaltyProgram({ active: true, rewards: DEFAULT_LOYALTY_REWARDS });
      setLoyaltyProgram(savedProgram);
      setLoyaltySaveStatus('Suggested milestones created. You can edit each reward at any time.');
    } catch (error) {
      console.error('Failed to create suggested loyalty rewards', error);
      setLoyaltySaveStatus(error?.message || 'Suggested rewards could not be created.');
    } finally {
      rewardActionInFlightRef.current = false;
      setLoyaltySaving(false);
    }
  };

  const totalUsers = localUsers.length;
  const activeUsers = localUsers.filter((u) => u.status === 'active').length;
  const viewingCustomer = localUsers.find((customer) => customer.id === viewingUser?.id) || viewingUser;
  const viewingCustomerSummary = viewingCustomer
    ? customerSummaryById.get(viewingCustomer.id)
      || getCustomerAppointmentSummary(viewingCustomer, visibleBookings, todayKey, loyaltyProgram)
    : null;

  const handleClaimCustomerReward = async (reward) => {
    if (!viewingCustomer || !viewingCustomerSummary || rewardClaimInFlightRef.current) return;
    if (reward?.status !== 'available' || !loyaltyProgram?.active) return;

    const confirmed = window.confirm(
      `Apply "${reward.name}" for ${viewingCustomer.fullName}? This reward will be marked as claimed. Their lifetime visit count will not change.`
    );
    if (!confirmed) return;

    rewardClaimInFlightRef.current = true;
    setClaimingRewardUserId(viewingCustomer.id);
    setRewardActionStatus('Claiming reward...');
    try {
      await claimCustomerLoyaltyReward(
        viewingCustomer.id,
        reward.id,
        loyaltyProgram,
        viewingCustomerSummary.completedVisits
      );
      setRewardActionStatus(`${reward.name} was marked as claimed. Lifetime visits were preserved.`);
    } catch (error) {
      console.error('Failed to claim customer loyalty reward', error);
      setRewardActionStatus(error?.message || 'The reward could not be claimed.');
    } finally {
      rewardClaimInFlightRef.current = false;
      setClaimingRewardUserId('');
    }
  };
  const selectedBookingService = getBookingService(selectedBooking);
  const selectedBookingNailArt = getBookingNailArt(selectedBooking, selectedBookingService);
  const selectedBookingBasePrice = Number(selectedBooking?.basePrice ?? selectedBookingService?.price ?? 0) || 0;
  const selectedBookingBaseTotal = Number(selectedBooking?.baseTotal ?? selectedBookingBasePrice) || 0;
  const selectedBookingPreferences = getPreferenceRows(selectedBookingCustomer);
  const selectedBookingHasConflict = selectedBooking ? appointmentConflicts.some((conflict) => (
    conflict.date === selectedBooking.date && conflict.time === selectedBooking.time
  )) : false;
  const selectedReminder24h = getReminderDisplay(selectedBooking, 'reminder24h');
  const selectedReminder12h = getReminderDisplay(selectedBooking, 'reminder12h');

  const statusCounts = ADMIN_BOOKING_STATUSES.reduce((counts, status) => ({
    ...counts,
    [status]: visibleBookings.filter((booking) => normalizeBookingStatus(booking.status) === status).length,
  }), {});

  const statCards = [
    { label: 'Total customers', value: totalUsers, icon: 'users' },
    { label: "Today's appointments", value: bookingsToday.length, icon: 'clock' },
    { label: '7-day bookings', value: bookingsThisWeek.length, icon: 'calendar' },
    { label: 'Upcoming appointments', value: upcomingBookings, icon: 'calendar' },
    { label: 'Pending requests', value: statusCounts['Pending Confirmation'] || 0, icon: 'bell' },
    { label: 'Completed visits', value: statusCounts.Completed || 0, icon: 'grid' },
    { label: 'Loyalty members', value: loyaltyMembers, icon: 'users' },
    { label: 'Rewards available', value: availableRewards, icon: 'bell' },
  ];

  return (
    <div className={cx('adm-shell', sidebarCollapsed && 'adm-shell--collapsed', activeTab === 'rewards' && 'adm-shell--rewards')}>
      {/* ---------------- Sidebar ---------------- */}
      <aside className={cx('adm-sidebar', mobileNavOpen && 'adm-sidebar--open')}>
        <div className="adm-sidebar-top">
          <div className="adm-brand">
            <span className="adm-brand-mark">
              <img
                src="/assets/ln-logo.jpg"
                alt="Luxe Nails by Piya"
                width="44"
                height="44"
              />
            </span>
            {!sidebarCollapsed && (
              <span className="adm-brand-text">
                Luxe Nails
                <em>Admin Console</em>
              </span>
            )}
          </div>
          <button
            type="button"
            className="adm-collapse-btn"
            onClick={() => setSidebarCollapsed((v) => !v)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {I(sidebarCollapsed ? 'chevronRight' : 'chevronLeft', 16)}
          </button>
        </div>

        <nav className="adm-nav">
          {ADMIN_NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={cx('adm-nav-item', activeTab === item.key && 'adm-nav-item--active')}
              onClick={() => { setActiveTab(item.key); setMobileNavOpen(false); }}
              title={item.label}
            >
              <span className="adm-nav-icon">{I(item.icon, 18)}</span>
              {!sidebarCollapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="adm-sidebar-bottom">
          <button type="button" className="adm-signout-btn" onClick={onSignOut}>
            <span className="adm-nav-icon">{I('logout', 18)}</span>
            {!sidebarCollapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>

      {mobileNavOpen && <div className="adm-scrim" onClick={() => setMobileNavOpen(false)} />}

      {/* ---------------- Main content ---------------- */}
      <div className="adm-main">
        <header className="adm-topbar">
          <button
            type="button"
            className="adm-mobile-menu-btn"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            {I('menu', 20)}
          </button>
          <div className="adm-topbar-heading">
            <h1>{ADMIN_PAGE_TITLES[activeTab].title}</h1>
            <p>{ADMIN_PAGE_TITLES[activeTab].subtitle}</p>
          </div>
          <div className="adm-topbar-actions">
            <div className="adm-notification-wrap" ref={adminNotificationRef}>
              <button
                type="button"
                className={cx('adm-notification-bell', adminNotificationOpen && 'is-active')}
                onClick={() => setAdminNotificationOpen((open) => !open)}
                aria-label={unreadAdminNotificationCount ? `${unreadAdminNotificationCount} unread Admin notifications` : 'Admin notifications'}
                aria-expanded={adminNotificationOpen}
                title="Notifications"
              >
                {I('bell', 20)}
                {unreadAdminNotificationCount > 0 ? <span className="adm-notification-badge">{unreadAdminNotificationCount > 9 ? '9+' : unreadAdminNotificationCount}</span> : null}
              </button>
              {adminNotificationOpen ? (
                <section className="adm-notification-panel" aria-label="Admin notifications">
                  <header className="adm-notification-panel-head">
                    <div><strong>Notifications</strong><span>{unreadAdminNotificationCount ? `${unreadAdminNotificationCount} unread` : "You're all caught up."}</span></div>
                    {unreadAdminNotificationCount ? <button type="button" onClick={handleMarkAllAdminNotificationsRead}>Mark all as read</button> : null}
                  </header>
                  <div className="adm-notification-list">
                    {adminNotificationError ? <p className="adm-notification-empty">{adminNotificationError}</p> : displayedAdminNotifications.length ? displayedAdminNotifications.map((notification) => {
                      const content = getAdminNotificationContent(notification, bookings, appointmentChangeRequests);
                      return (
                        <button
                          type="button"
                          className={cx('adm-notification-item', notification.read ? 'is-read' : 'is-unread', notification.handled && 'is-handled')}
                          key={notification.id}
                          onClick={() => handleAdminNotificationClick(notification)}
                        >
                          <span className="adm-notification-item-icon">{notification.type === 'new_booking' ? I('calendar', 16) : I('bell', 16)}</span>
                          <span className="adm-notification-item-copy">
                            <strong>{content.title}</strong>
                            <span>{content.message}</span>
                            <small>{formatAdminNotificationTime(notification.createdAt, salonTimeZone)}</small>
                            <em>{content.action}</em>
                          </span>
                        </button>
                      );
                    }) : <div className="adm-notification-empty">{I('bell', 22)}<span>No new notifications.</span></div>}
                  </div>
                  {adminNotifications.length > 8 ? <button className="adm-notification-view-all" type="button" onClick={() => setAdminNotificationExpanded((expanded) => !expanded)}>{adminNotificationExpanded ? 'Show latest' : 'View all notifications'}</button> : null}
                </section>
              ) : null}
            </div>
            <button type="button" className="adm-avatar" title="Admin" onClick={() => setActiveTab('bookings')}>AD</button>
          </div>
        </header>

        <main className="adm-content">
          {backendError ? (
            <div className="adm-alert adm-alert--warning" role="alert">
              <strong>Sync issue:</strong> {backendError}
            </div>
          ) : null}
          {notificationVisible && notificationBooking ? (
            <div className="adm-booking-notification" role="status" aria-live="polite">
              <div>
                <strong>{notificationBooking.isChangeRequest ? `New ${notificationBooking.type} request` : 'New booking received'}</strong>
                <p>{notificationBooking.isChangeRequest ? 'A customer submitted an appointment change request for review.' : <>{notificationBooking.customerName || notificationBooking.name || 'A guest'} booked {getBookingServiceLabel(notificationBooking)}{getBookingNailQuantity(notificationBooking) ? ` (${getBookingNailQuantity(notificationBooking)} nails)` : ''}{getNailArtSummary(notificationBooking) ? ` with ${getNailArtSummary(notificationBooking)}` : ''} for {notificationBooking.date} at {notificationBooking.time}.</>}</p>
              </div>
              <div className="adm-booking-notification-actions">
                {!soundEnabled ? (
                  <button type="button" className="adm-notification-btn" onClick={handleEnableSound}>Enable sound</button>
                ) : null}
                <button type="button" className="adm-notification-btn adm-notification-btn--primary" onClick={handleNotificationClick}>{notificationBooking.isChangeRequest ? 'Review request' : 'View booking'}</button>
              </div>
            </div>
          ) : null}
          {activeTab === 'overview' && (
            <>
              <section className="adm-stat-grid">
                {statCards.map((card) => (
                  <button key={card.label} type="button" className="adm-stat-card" onClick={() => handleStatCardClick(card.label)}>
                    <div className="adm-stat-icon">{I(card.icon, 20)}</div>
                    <div>
                      <span className="adm-stat-label">{card.label}</span>
                      <strong className="adm-stat-value">{card.value}</strong>
                    </div>
                  </button>
                ))}
              </section>

              {/* Quick access panel removed */}

              <section className="adm-panel">
                <div className="adm-panel-head">
                  <h2>7-day calendar</h2>
                </div>
                <div className="adm-calendar-grid">
                  {weeklyCalendar.map((day) => (
                    <button
                      key={day.key}
                      type="button"
                      className={cx('adm-calendar-day', day.key === todayKey && 'adm-calendar-day--today')}
                      onClick={() => handleCalendarDayClick(day.key)}
                      aria-label={`Manage availability on ${day.label}: ${day.availability.label}, ${day.count} booked`}
                    >
                      <span>{DAY_NAMES[new Date(`${day.key}T12:00:00`).getDay()]}</span>
                      <strong>{day.label}</strong>
                      <div className="adm-calendar-count">{day.count} booked</div>
                      <small className={`adm-calendar-availability is-${day.availability.status}`}>{day.availability.label}</small>
                    </button>
                  ))}
                </div>
              </section>

              <div className="adm-two-col">
                <section className="adm-panel">
                  <div className="adm-panel-head">
                    <h2>Today's schedule</h2>
                  </div>
                  {loading && <div className="adm-loading-row">Loading schedule…</div>}
                  {!loading && bookingsToday.length === 0 && (
                    <div className="adm-empty-state">
                      <div className="adm-empty-icon">{I('calendar', 22)}</div>
                      <p>No appointments scheduled for today.</p>
                    </div>
                  )}
                  {!loading && bookingsToday.length > 0 && (
                    <div className="adm-schedule-list">
                      {bookingsToday.map((booking) => (
                        <button key={booking.id} type="button" className="adm-schedule-item" onClick={() => handleOpenBooking(booking)}>
                          <div className="adm-schedule-main">
                            <strong>{getBookingServiceLabel(booking)}</strong>
                            <span>{formatTime(booking.time)}</span>
                          </div>
                          <div className="adm-schedule-guest">
                            <span>{getBookingCustomerName(booking)}</span>
                            <span className={cx(
                              'adm-badge',
                              normalizeBookingStatus(booking.status) === 'Pending Confirmation' ? 'adm-badge--warning'
                                : normalizeBookingStatus(booking.status) === 'Confirmed' ? 'adm-badge--success'
                                : 'adm-badge--muted'
                            )}>{normalizeBookingStatus(booking.status)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </section>

                <section className="adm-panel">
                  <div className="adm-panel-head">
                    <h2>Top services</h2>
                  </div>
                  {topServices.length === 0 ? (
                    <div className="adm-empty-state">
                      <div className="adm-empty-icon">{I('grid', 22)}</div>
                      <p>No booking data available yet.</p>
                    </div>
                  ) : (
                    <div className="adm-stats-list">
                      {topServices.map(([service, count]) => (
                        <div key={service} className="adm-stats-row">
                          <span>{service}</span>
                          <strong>{count} bookings</strong>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}

          {activeTab === 'portfolio' && (
            <div className="adm-two-col adm-two-col--portfolio">
              <section className="adm-panel">
                <div className="adm-panel-head">
                  <h2>{editId ? 'Edit portfolio image' : 'Add portfolio image'}</h2>
                </div>
                <form onSubmit={handleSubmit} className="adm-form">
                  <label className="adm-field">
                    <span>Title</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nail set name" />
                  </label>
                  <label className="adm-field">
                    <span>Category</span>
                    <select value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="">Select category</option>
                      {categoryOptions.map((cat) => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </label>
                  <label className="adm-field">
                    <span>Style / Design type (optional)</span>
                    <select value={style} onChange={(e) => setStyle(e.target.value)}>
                      <option value="">Select a design style</option>
                      {styleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="adm-field">
                    <span>Description</span>
                    <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Add a short description" rows={3} />
                  </label>
                  <label className="adm-field">
                    <span>Nail shape (optional)</span>
                    <select value={shape} onChange={(e) => setShape(e.target.value)}>
                      <option value="">Select a nail shape</option>
                      {shapeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="adm-field">
                    <span>Length (optional)</span>
                    <select value={length} onChange={(e) => setLength(e.target.value)}>
                      <option value="">Select a nail length</option>
                      {lengthOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="adm-field">
                    <span>Finish (optional)</span>
                    <select value={finish} onChange={(e) => setFinish(e.target.value)}>
                      <option value="">Select a finish</option>
                      {finishOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </label>
                  <label className="adm-field">
                    <span>Choose file</span>
                    <input
                      ref={portfolioFileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleFileChange}
                      disabled={isSaving}
                    />
                    <small className="adm-upload-help">JPG, PNG or WebP • Max 8 MB</small>
                    {imageFile && (
                      <small className="adm-selected-file">
                        {imageFile.name} • {formatFileSize(imageFile.size)}
                      </small>
                    )}
                  </label>
                  {previewSrc && (
                    <div className="adm-image-preview">
                      <img src={previewSrc} alt="Preview" decoding="async" />
                    </div>
                  )}
                  <div className="adm-form-actions">
                    <button className="adm-btn adm-btn--primary" type="submit" disabled={isSaving}>
                      {I(editId ? 'edit' : 'plus', 16)}
                      {isSaving ? 'Saving…' : editId ? 'Save changes' : 'Add to portfolio'}
                    </button>
                    {editId && (
                      <button className="adm-btn adm-btn--ghost" type="button" onClick={handleCancelEdit} disabled={isSaving}>
                        Cancel
                      </button>
                    )}
                  </div>
                  {isSaving && (
                    <div className="adm-upload-progress">
                      <div className="adm-upload-bar" style={{ width: `${uploadProgress}%` }} />
                      <div className="adm-upload-label">Uploading: {uploadProgress}%</div>
                    </div>
                  )}
                  {uploadError && <p className="adm-upload-error" role="alert">{uploadError}</p>}
                  {uploadSuccess && <p className="adm-upload-success" role="status">{uploadSuccess}</p>}
                </form>
              </section>

              <section className="adm-panel">
                <div className="adm-panel-head">
                  <h2>Portfolio preview</h2>
                  <span className="adm-count-pill">{works.length} images</span>
                </div>
                {works.length === 0 ? (
                  <div className="adm-empty-state">
                    <div className="adm-empty-icon">{I('image', 22)}</div>
                    <p>No portfolio images yet. Add your first piece to the left.</p>
                  </div>
                ) : (
                  <div className="adm-work-grid">
                    {works.map((work) => (
                      <div key={work.id} className="adm-work-card">
                        {work.image ? <img src={work.thumbnail || work.image} alt={work.title} loading="lazy" decoding="async" /> : <div className="adm-work-placeholder">No image</div>}
                        <div className="adm-work-meta">
                          <div>
                            <strong>{work.title}</strong>
                            <div className="muted">{work.category}</div>
                            <span className={cx('adm-badge', work.visible === false ? 'adm-badge--muted' : 'adm-badge--success')}>{work.visible === false ? 'Hidden' : 'Visible'}</span>
                            {work.description ? <p className="adm-work-description">{work.description}</p> : null}
                          </div>
                          <div className="adm-icon-actions">
                            <button className="adm-icon-btn" type="button" onClick={() => handleEditWork(work)} title="Edit item">
                              {I('edit', 15)}
                            </button>
                            <button className="adm-icon-btn" type="button" onClick={() => handleToggleWorkVisibility(work)} title={work.visible === false ? 'Show in gallery' : 'Hide from gallery'}>
                              {I('eye', 15)}
                            </button>
                            <button className="adm-icon-btn" type="button" onClick={() => onMoveWork?.(work.id, 'up')} disabled={works.findIndex((item) => item.id === work.id) === 0} title="Move up">
                              {I('chevronUp', 15)}
                            </button>
                            <button className="adm-icon-btn" type="button" onClick={() => onMoveWork?.(work.id, 'down')} disabled={works.findIndex((item) => item.id === work.id) === works.length - 1} title="Move down">
                              {I('chevronDown', 15)}
                            </button>
                            <button className="adm-icon-btn adm-icon-btn--danger" type="button" onClick={() => handleDeletePortfolioWork(work)} disabled={deletingWorkId != null} title={deletingWorkId === work.id ? 'Deleting' : 'Delete'}>
                              {I('trash', 15)}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'bookings' && (
            <>
              <section className="adm-panel">
                <div className="adm-panel-head adm-panel-head--space-between">
                  <div>
                    <h2>Appointments</h2>
                    <p className="adm-panel-subtitle">Review service selections, customization, reference photos, and appointment status.</p>
                  </div>
                  <div className="adm-booking-status-chips">
                    {APPOINTMENT_FILTERS.map((filter) => (
                      <button
                        key={filter}
                        type="button"
                        className={cx('adm-filter-chip', !selectedAppointmentDate && bookingStatusFilter === filter && 'adm-filter-chip--active')}
                        onClick={() => {
                          setSelectedAppointmentDate('');
                          setBookingStatusFilter(filter);
                        }}
                      >
                        {filter} · {visibleBookings.filter((booking) => matchesAppointmentFilter(booking, filter, todayKey)).length}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={cx('adm-filter-chip', !selectedAppointmentDate && bookingStatusFilter === 'Cancellation Requests' && 'adm-filter-chip--active')}
                      onClick={() => {
                        setSelectedAppointmentDate('');
                        setBookingStatusFilter('Cancellation Requests');
                      }}
                    >
                      Cancellation Requests {'\u00b7'} {pendingAppointmentRequests.filter((request) => request.type === 'cancellation').length}
                    </button>
                  </div>
                </div>
              </section>
              {bookingActionError ? (
                <div className="adm-alert adm-alert--warning" role="alert">{bookingActionError}</div>
              ) : null}
              {pendingAppointmentRequests.length > 0 ? (
                <section className="adm-panel adm-request-panel" aria-labelledby="appointment-request-title">
                  <div className="adm-panel-head">
                    <h2 id="appointment-request-title">Appointment change requests</h2>
                    <p className="adm-panel-subtitle">The original confirmed time stays blocked until you approve a request.</p>
                  </div>
                  <div className="adm-request-list">
                    {pendingAppointmentRequests.map((request) => {
                      const booking = bookings.find((item) => item.id === request.bookingId);
                      return (
                        <article className="adm-request-card" key={request.id}>
                          <div className="adm-request-copy">
                            <span className="adm-settings-kicker">{request.type === 'cancellation' ? 'Cancellation request' : 'Reschedule request'}</span>
                            <strong>{booking?.customerName || booking?.name || 'Customer'} · {getBookingServiceLabel(booking)}</strong>
                            <p>Current: {formatDate(booking?.date)} · {formatTime(booking?.time)}</p>
                            {request.type === 'reschedule' ? <p>Requested: <b>{formatDate(request.requestedDate)} · {formatTime(request.requestedTime)}</b></p> : null}
                            {request.reason ? <p>Reason: {request.reason}</p> : null}
                            <small>Sent {formatBookingCreatedAt(request.createdAt, salonTimeZone) || 'recently'}</small>
                          </div>
                          <div className="adm-request-actions">
                            <button className="adm-btn adm-btn--ghost adm-btn--sm" type="button" onClick={() => booking && setSelectedBookingId(booking.id)}>Review</button>
                            <button className="adm-btn adm-btn--primary adm-btn--sm" type="button" disabled={requestUpdatingId === request.id} onClick={() => openRequestReviewDialog(request, 'Approved')}>{requestUpdatingId === request.id ? 'Approving...' : 'Approve'}</button>
                            <button className="adm-btn adm-btn--danger adm-btn--sm" type="button" disabled={requestUpdatingId === request.id} onClick={() => openRequestReviewDialog(request, 'Declined')}>{requestUpdatingId === request.id ? 'Declining...' : 'Decline'}</button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              ) : null}
              {appointmentConflicts.length > 0 ? (
                <div className="adm-alert adm-alert--warning" role="alert">
                  <strong>Scheduling conflict:</strong>{' '}
                  {appointmentConflicts.map((conflict) => `${conflict.appointments.length} appointments on ${formatDate(conflict.date)} at ${formatTime(conflict.time)}`).join(' · ')}
                </div>
              ) : null}
              <div className="adm-appointment-tools">
                <label className="adm-search">
                  {I('search', 16)}
                  <input value={appointmentSearch} onChange={(event) => setAppointmentSearch(event.target.value)} placeholder="Search customer, phone, or service" />
                </label>
                <label className="adm-inline-field"><span>From</span><input type="date" value={appointmentFromDate} onChange={(event) => setAppointmentFromDate(event.target.value)} /></label>
                <label className="adm-inline-field"><span>To</span><input type="date" value={appointmentToDate} onChange={(event) => setAppointmentToDate(event.target.value)} /></label>
                <label className="adm-inline-field"><span>Sort</span><select value={appointmentSort} onChange={(event) => setAppointmentSort(event.target.value)}><option value="nearest">Nearest appointment</option><option value="newest">Newest booking</option><option value="oldest">Oldest booking</option></select></label>
              </div>
              <section className="adm-panel adm-panel--table">
                <div className="adm-panel-head">
                  <div>
                    <h2>{selectedAppointmentDate ? `Appointments for ${formatDate(selectedAppointmentDate)}` : bookingStatusFilter}</h2>
                    {selectedAppointmentDate ? (
                      <button type="button" className="adm-text-btn" onClick={() => setSelectedAppointmentDate('')}>Clear date filter</button>
                    ) : null}
                  </div>
                  <span className="adm-count-pill">{filteredAppointments.length} appointment{filteredAppointments.length === 1 ? '' : 's'}</span>
                </div>
                {loading && <div className="adm-loading-row">Loading bookings…</div>}
                {!loading && filteredAppointments.length === 0 && (
                  <div className="adm-empty-state">
                    <div className="adm-empty-icon">{I('calendar', 22)}</div>
                    <p>No appointments match this filter.</p>
                  </div>
                )}
                {!loading && filteredAppointments.length > 0 && (
                  <div className="adm-table-wrap">
                    <table className="adm-table adm-table--bookings">
                      <thead>
                        <tr>
                          <th>Customer</th>
                          <th>Service</th>
                          <th>Date / Time</th>
                          <th>Estimated total</th>
                          <th>Status</th>
                          <th>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAppointments.map((booking) => {
                          const normalizedStatus = normalizeBookingStatus(booking.status);
                          const bookedOn = formatBookingCreatedAt(booking.createdAt, salonTimeZone);
                          const hasConflict = appointmentConflicts.some((conflict) => (
                            conflict.date === booking.date && conflict.time === booking.time
                          ));
                          const pendingRequest = pendingRequestByBookingId.get(booking.id);
                          return (
                          <tr key={booking.id} className={selectedBookingId === booking.id ? 'adm-table-row--selected' : ''}>
                            <td>
                              <strong>{getBookingCustomerName(booking)}</strong>
                              <small className="adm-booking-customization">{getBookingCustomerPhone(booking) || booking.email || 'No contact saved'}</small>
                            </td>
                            <td>
                              <div>{getBookingServiceLabel(booking)}</div>
                              {getBookingNailQuantity(booking) ? ` (${getBookingNailQuantity(booking)} nails)` : ''}
                              {getNailArtSummary(booking) ? <small className="adm-booking-customization">{getNailArtSummary(booking)}</small> : null}
                            </td>
                            <td>
                              <div>{formatDate(booking.date)}</div>
                              <small className="adm-booking-customization">{formatTime(booking.time)}</small>
                              <small className="adm-booking-created-at">
                                {bookedOn ? `Booked ${bookedOn}` : 'Booked date unavailable'}
                              </small>
                              {hasConflict ? <small className="adm-conflict-label">Scheduling conflict</small> : null}
                              {['Pending Confirmation', 'Confirmed'].includes(normalizedStatus) && !isAppointmentWithinAvailability(booking, businessSettings) ? <small className="adm-conflict-label">Outside available hours · Review needed</small> : null}
                            </td>
                            <td><strong className="adm-booking-total">{formatPeso(getBookingTotal(booking))}</strong></td>
                            <td>
                              <span className={cx(
                                'adm-badge',
                                normalizedStatus === 'Pending Confirmation' ? 'adm-badge--warning'
                                  : normalizedStatus === 'Confirmed' ? 'adm-badge--success'
                                  : normalizedStatus === 'Cancelled' || normalizedStatus === 'No Show' ? 'adm-badge--danger'
                                  : 'adm-badge--muted'
                              )}>
                                {normalizedStatus}
                              </span>
                              {pendingRequest ? <small className="adm-request-indicator">{pendingRequest.type === 'cancellation' ? 'Cancellation requested' : 'Reschedule requested'}</small> : null}
                            </td>
                            <td>
                              <div className="adm-booking-actions">
                                {normalizedStatus === 'Pending Confirmation' ? (
                                  <div className="adm-quick-actions">
                                    <button className="adm-btn adm-btn--primary adm-btn--sm" type="button" disabled={statusUpdatingId === booking.id} onClick={() => handleBookingAction(booking.id, 'Confirmed')}>Confirm</button>
                                    <button className="adm-btn adm-btn--danger adm-btn--sm" type="button" disabled={statusUpdatingId === booking.id} onClick={() => window.confirm('Decline this appointment?') && handleBookingAction(booking.id, 'Cancelled')}>Decline</button>
                                  </div>
                                ) : normalizedStatus === 'Confirmed' ? (
                                  <div className="adm-quick-actions">
                                    <button className="adm-btn adm-btn--primary adm-btn--sm" type="button" disabled={statusUpdatingId === booking.id} onClick={() => handleBookingAction(booking.id, 'Completed')}>Complete</button>
                                    {pendingRequest?.type === 'cancellation' ? <button className="adm-btn adm-btn--danger adm-btn--sm" type="button" onClick={() => setSelectedBookingId(booking.id)}>Review request</button> : <button className="adm-btn adm-btn--danger adm-btn--sm" type="button" disabled={statusUpdatingId === booking.id} onClick={() => window.confirm('Cancel this appointment?') && handleBookingAction(booking.id, 'Cancelled')}>Cancel</button>}
                                  </div>
                                ) : null}
                                <button className="adm-btn adm-btn--ghost adm-btn--sm" type="button" onClick={() => handleOpenBooking(booking)}>
                                  View details
                                </button>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>

                    </table>
                  </div>
                )}
                {!loading && filteredAppointments.length > 0 && (
                  <div className="adm-appointment-cards">
                    {filteredAppointments.map((booking) => {
                      const normalizedStatus = normalizeBookingStatus(booking.status);
                      const bookedOn = formatBookingCreatedAt(booking.createdAt, salonTimeZone);
                      const hasConflict = appointmentConflicts.some((conflict) => (
                        conflict.date === booking.date && conflict.time === booking.time
                      ));
                      const pendingRequest = pendingRequestByBookingId.get(booking.id);
                      return (
                        <article className="adm-appointment-card" key={booking.id}>
                          <header className="adm-appointment-card-head">
                            <div>
                              <strong>{getBookingCustomerName(booking)}</strong>
                              <small>{getBookingServiceLabel(booking)}</small>
                            </div>
                          </header>
                          <div className="adm-appointment-card-grid">
                            <div className="adm-appointment-card-field adm-appointment-card-field--wide">
                              <span>Appointment</span>
                              <strong>{formatDate(booking.date)} · {formatTime(booking.time)}</strong>
                            </div>
                            <div className="adm-appointment-card-field adm-appointment-card-field--wide">
                              <span>Booked</span>
                              <strong>{bookedOn || 'Date unavailable'}</strong>
                            </div>
                            <div className="adm-appointment-card-field">
                              <span>Status</span>
                              <strong>{normalizedStatus}</strong>
                            </div>
                            <div className="adm-appointment-card-field">
                              <span>Total</span>
                              <strong>{formatPeso(getBookingTotal(booking))}</strong>
                            </div>
                          </div>
                          {getNailArtSummary(booking) ? <small className="adm-booking-customization">{getNailArtSummary(booking)}</small> : null}
                          {pendingRequest ? <small className="adm-request-indicator">{pendingRequest.type === 'cancellation' ? 'Cancellation requested' : 'Reschedule requested'}</small> : null}
                          {hasConflict ? <small className="adm-conflict-label">Scheduling conflict</small> : null}
                          {['Pending Confirmation', 'Confirmed'].includes(normalizedStatus) && !isAppointmentWithinAvailability(booking, businessSettings) ? <small className="adm-conflict-label">Outside available hours · Review needed</small> : null}
                          <footer className="adm-appointment-card-actions">
                            {normalizedStatus === 'Pending Confirmation' ? (
                              <>
                                <button className="adm-btn adm-btn--primary adm-btn--sm" type="button" disabled={statusUpdatingId === booking.id} onClick={() => handleBookingAction(booking.id, 'Confirmed')}>Confirm</button>
                                <button className="adm-btn adm-btn--danger adm-btn--sm" type="button" disabled={statusUpdatingId === booking.id} onClick={() => window.confirm('Decline this appointment?') && handleBookingAction(booking.id, 'Cancelled')}>Decline</button>
                              </>
                            ) : normalizedStatus === 'Confirmed' ? (
                              <>
                                <button className="adm-btn adm-btn--primary adm-btn--sm" type="button" disabled={statusUpdatingId === booking.id} onClick={() => handleBookingAction(booking.id, 'Completed')}>Complete</button>
                                {pendingRequest?.type === 'cancellation' ? <button className="adm-btn adm-btn--danger adm-btn--sm" type="button" onClick={() => setSelectedBookingId(booking.id)}>Review request</button> : <button className="adm-btn adm-btn--danger adm-btn--sm" type="button" disabled={statusUpdatingId === booking.id} onClick={() => window.confirm('Cancel this appointment?') && handleBookingAction(booking.id, 'Cancelled')}>Cancel</button>}
                              </>
                            ) : null}
                            <button className="adm-btn adm-btn--ghost adm-btn--sm" type="button" onClick={() => handleOpenBooking(booking)}>View details</button>
                          </footer>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === 'availability' && (
            <><SparkBookingPublication /><BookingAvailabilityManager
              settings={businessSettings}
              bookings={visibleBookings}
              selectedDate={availabilityDate}
              onDateChange={setAvailabilityDate}
              onSave={saveBookingAvailability}
              onViewAppointment={(booking) => setSelectedBookingId(booking.id)}
              loading={businessSettingsLoading || loading}
              loadError={businessSettingsError || backendError}
            /></>
          )}

          {activeTab === 'settings' && (
            <AdminSettings
              settings={businessSettings}
              draft={settingsDraft}
              onFieldChange={updateSettingsField}
              onHoursChange={updateWeeklyHours}
              onNailArtChange={handleNailArtEligibilityChange}
              onSave={handleSaveSettings}
              saving={settingsSaving}
              status={settingsStatus}
              loading={businessSettingsLoading}
              loadError={businessSettingsError}
            />
          )}

          {(activeTab === 'users' || activeTab === 'rewards') && (
            <>
              {activeTab === 'rewards' && (
              <>
              <RewardManagementList
                rewards={loyaltyProgram?.rewards || []}
                loading={loyaltyLoading}
                saving={loyaltySaving}
                loadError={loyaltyLoadError}
                onAdd={handleAddReward}
                onEdit={handleEditReward}
                onToggle={handleToggleReward}
                onInstallSuggested={handleInstallSuggestedRewards}
              />
              {loyaltySaveStatus ? <p className="adm-loyalty-save-status" role="status">{loyaltySaveStatus}</p> : null}
              {rewardDraft ? <RewardEditorModal
                draft={rewardDraft}
                rewards={loyaltyProgram?.rewards || []}
                saving={loyaltySaving}
                error={rewardSaveError}
                onChange={updateRewardDraft}
                onSave={handleSaveReward}
                onClose={() => setRewardDraft(null)}
              /> : null}
              <details className="adm-reward-activity">
                <summary>Customer reward activity</summary>
              <section className="adm-stat-grid adm-rewards-stat-grid" aria-label="Reward summary">
                <article className="adm-stat-card">
                  <span className="adm-stat-icon">{I('gift', 19)}</span>
                  <div><span className="adm-stat-label">Active rewards</span><strong className="adm-stat-value">{loyaltyProgram?.activeRewards?.length || 0}</strong></div>
                </article>
                <article className="adm-stat-card">
                  <span className="adm-stat-icon">{I('users', 19)}</span>
                  <div><span className="adm-stat-label">Customers with available rewards</span><strong className="adm-stat-value">{userLoading ? '…' : customersWithAvailableRewards.length}</strong></div>
                </article>
                <article className="adm-stat-card">
                  <span className="adm-stat-icon">{I('grid', 19)}</span>
                  <div><span className="adm-stat-label">Total rewards claimed</span><strong className="adm-stat-value">{userLoading ? '…' : totalRewardsClaimed}</strong></div>
                </article>
              </section>
              <div className="adm-two-col adm-rewards-insights">
                <section className="adm-panel">
                  <div className="adm-panel-head adm-panel-head--space-between">
                    <div>
                      <h2>Customers with available rewards</h2>
                      <p className="adm-panel-subtitle">Open a customer to apply an eligible reward.</p>
                    </div>
                    <span className="adm-count-pill">{customersWithAvailableRewards.length}</span>
                  </div>
                  {userLoading ? (
                    <div className="adm-loading-row">Loading customer rewards…</div>
                  ) : customersWithAvailableRewards.length > 0 ? (
                    <div className="adm-available-reward-customers">
                      {customersWithAvailableRewards.slice(0, 8).map(({ customer, summary }) => (
                        <article key={customer.id}>
                          <span className="adm-user-avatar">{initials(customer.fullName)}</span>
                          <div>
                            <strong>{customer.fullName}</strong>
                            <small>{summary.completedVisits} visits</small>
                            <p>{summary.milestones.filter((reward) => reward.status === 'available').map((reward) => reward.name).join(' · ')}</p>
                          </div>
                          <button className="adm-btn adm-btn--ghost adm-btn--sm" type="button" onClick={() => handleViewUser(customer)}>
                            View customer
                          </button>
                        </article>
                      ))}
                      {customersWithAvailableRewards.length > 8 ? (
                        <small className="adm-reward-list-note">Showing 8 of {customersWithAvailableRewards.length} customers.</small>
                      ) : null}
                    </div>
                  ) : (
                    <div className="adm-empty-state"><p>No customers currently have an available reward.</p></div>
                  )}
                </section>

                <section className="adm-panel">
                  <div className="adm-panel-head adm-panel-head--space-between">
                    <div>
                      <h2>Recent reward claims</h2>
                      <p className="adm-panel-subtitle">Latest claimed milestones across customers.</p>
                    </div>
                  </div>
                  {userLoading ? (
                    <div className="adm-loading-row">Loading reward claims…</div>
                  ) : recentRewardClaims.length > 0 ? (
                    <div className="adm-recent-reward-claims">
                      {recentRewardClaims.map(({ customer, reward }) => (
                        <article key={`${customer.id}-${reward.id}`}>
                          <div>
                            <strong>{customer.fullName}</strong>
                            <span>{reward.rewardName}</span>
                          </div>
                          <small>{formatDate(reward.claimedAt)}</small>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="adm-empty-state"><p>No reward claims have been recorded yet.</p></div>
                  )}
                </section>
              </div>
              </details>
              </>
              )}

              {activeTab === 'users' && (
              <section className="adm-panel">
              <div className="adm-panel-head adm-panel-head--users">
                <h2>All customers</h2>
                <span className="adm-count-pill">{filteredUsers.length} of {totalUsers} · {activeUsers} active</span>
              </div>

              <div className="adm-toolbar">
                <label className="adm-search">
                  {I('search', 16)}
                  <input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search by name, email, or phone"
                  />
                </label>
                <div className="adm-filter-chips">
                  {['all', 'active', 'inactive'].map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={cx('adm-filter-chip', statusFilter === status && 'adm-filter-chip--active')}
                      onClick={() => setStatusFilter(status)}
                    >
                      {status === 'all' ? 'All' : status === 'active' ? 'Active' : 'Deactivated'}
                    </button>
                  ))}
                </div>
              </div>

              {userLoading ? (
                <div className="adm-loading-row">Loading customers…</div>
              ) : filteredUsers.length === 0 ? (
                <div className="adm-empty-state">
                  <div className="adm-empty-icon">{I('users', 22)}</div>
                  <p>No customers match your search or filter.</p>
                </div>
              ) : (
                <>
                  <div className="adm-table-wrap adm-customer-table-wrap">
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th onClick={() => handleSort('fullName')}>Customer</th>
                          <th onClick={() => handleSort('phone')}>Phone number</th>
                          <th>Total visits</th>
                          <th>Rewards</th>
                          <th>Next appointment</th>
                          <th onClick={() => handleSort('status')}>Status</th>
                          <th className="adm-th-actions">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedUsers.map((user) => {
                          const summary = customerSummaryById.get(user.id)
                            || getCustomerAppointmentSummary(user, visibleBookings, todayKey, loyaltyProgram);
                          return (
                          <tr key={user.id}>
                            <td>
                              <div className="adm-user-cell">
                                <span className="adm-user-avatar">{initials(user.fullName)}</span>
                                <span><strong>{user.fullName}</strong><small>{user.email}</small></span>
                              </div>
                            </td>
                            <td>{user.phone || '—'}</td>
                            <td>{summary.completedVisits}</td>
                            <td>
                              <strong className="adm-booking-total">
                                {summary.availableRewards} available
                              </strong>
                              <small className="adm-loyalty-table-status">
                                {summary.rewardStatus === 'inactive'
                                  ? 'No active milestones'
                                  : `${summary.rewardsUnlocked} unlocked · ${summary.claimedRewards} claimed`}
                              </small>
                              {summary.nextReward ? (
                                <small className="adm-loyalty-table-status">
                                  Next: {summary.nextReward.progress} / {summary.nextReward.requiredVisits} visits
                                </small>
                              ) : null}
                            </td>
                            <td>{summary.nextAppointment ? `${formatDate(summary.nextAppointment.date)} · ${formatTime(summary.nextAppointment.time)}` : 'None scheduled'}</td>
                            <td>
                              <span className={cx('adm-badge', user.status === 'active' ? 'adm-badge--active' : 'adm-badge--inactive')}>
                                {user.status === 'active' ? 'Active' : 'Deactivated'}
                              </span>
                            </td>
                            <td>
                              <div className="adm-icon-actions">
                                <button className="adm-btn adm-btn--ghost adm-btn--sm" type="button" onClick={() => handleViewUser(user)}>View customer</button>
                                <button className="adm-btn adm-btn--ghost adm-btn--sm" type="button" onClick={() => handleToggleStatus(user)}>
                                  {user.status === 'active' ? 'Deactivate' : 'Activate'}
                                </button>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="adm-customer-cards">
                    {pagedUsers.map((user) => {
                      const summary = customerSummaryById.get(user.id)
                        || getCustomerAppointmentSummary(user, visibleBookings, todayKey, loyaltyProgram);
                      return (
                        <article className="adm-customer-card" key={user.id}>
                          <div className="adm-user-cell">
                            <span className="adm-user-avatar">{initials(user.fullName)}</span>
                            <span><strong>{user.fullName}</strong><small>{user.email}</small><small>{user.phone || 'No phone saved'}</small></span>
                          </div>
                          <div className="adm-customer-card-stats"><span><small>Visits</small><strong>{summary.completedVisits}</strong></span><span><small>Rewards</small><strong>{summary.availableRewards}</strong></span><span><small>Next appointment</small><strong>{summary.nextAppointment ? `${formatDate(summary.nextAppointment.date)} · ${formatTime(summary.nextAppointment.time)}` : 'None scheduled'}</strong></span></div>
                          <div className="adm-customer-card-footer"><span className={cx('adm-badge', user.status === 'active' ? 'adm-badge--active' : 'adm-badge--inactive')}>{user.status === 'active' ? 'Active' : 'Deactivated'}</span><button className="adm-btn adm-btn--ghost adm-btn--sm" type="button" onClick={() => handleViewUser(user)}>View customer</button></div>
                        </article>
                      );
                    })}
                  </div>

                  <div className="adm-pagination">
                    <span className="muted">
                      Page {userPage} of {totalUserPages}
                    </span>
                    <div className="adm-pagination-controls">
                      <button
                        type="button"
                        className="adm-btn adm-btn--ghost adm-btn--sm"
                        disabled={userPage === 1}
                        onClick={() => setUserPage((p) => Math.max(1, p - 1))}
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        className="adm-btn adm-btn--ghost adm-btn--sm"
                        disabled={userPage === totalUserPages}
                        onClick={() => setUserPage((p) => Math.min(totalUserPages, p + 1))}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}
              </section>
              )}
            </>
          )}
        </main>
      </div>

      {/* ---------------- Appointment details modal ---------------- */}
      {selectedBooking && (
        <div className="adm-modal-scrim" onClick={() => setSelectedBookingId(null)}>
          <div className="adm-modal adm-modal--wide" onClick={(event) => event.stopPropagation()}>
            <div className="adm-modal-head">
              <div>
                <h3>Appointment details</h3>
                <span className="adm-modal-kicker">Booking {selectedBooking.id}</span>
              </div>
              <button className="adm-icon-btn" type="button" onClick={() => setSelectedBookingId(null)} aria-label="Close appointment details">{I('x', 16)}</button>
            </div>
            <div className="adm-modal-body">
              {selectedBookingHasConflict ? (
                <div className="adm-alert adm-alert--warning">
                  <strong>Scheduling conflict:</strong> another active appointment uses {formatDate(selectedBooking.date)} at {formatTime(selectedBooking.time)}.
                </div>
              ) : null}
              {bookingActionError ? <div className="adm-alert adm-alert--warning">{bookingActionError}</div> : null}

              <div className="adm-details-grid">
                {['Pending Confirmation', 'Confirmed'].includes(normalizeBookingStatus(selectedBooking.status)) && !isAppointmentWithinAvailability(selectedBooking, businessSettings) ? <div className="adm-alert adm-alert--warning adm-detail-card--full">This appointment falls outside the current available hours. Review it with the client; its booking has been preserved.</div> : null}
                <section className="adm-detail-card">
                  <h4>Customer</h4>
                  <strong>{getBookingCustomerName(selectedBooking)}</strong>
                  <p>{getBookingCustomerPhone(selectedBooking) || 'No phone saved'}</p>
                  <p>{selectedBooking.email || selectedBooking.customerEmail || 'No email saved'}</p>
                  {selectedBooking.address ? <p>{selectedBooking.address}</p> : null}
                </section>

                <section className="adm-detail-card">
                  <h4>Service & schedule</h4>
                  <strong>{getBookingServiceLabel(selectedBooking)}</strong>
                  <p>{formatDate(selectedBooking.date)}</p>
                  <p>{formatTime(selectedBooking.time)}</p>
                  {getBookingNailQuantity(selectedBooking) ? <p>{getBookingNailQuantity(selectedBooking)} repair nails</p> : null}
                </section>

                <section className="adm-detail-card">
                  <h4>Booking information</h4>
                  <div className="adm-detail-row">
                    <span>Booked On</span>
                    <strong>{formatBookingCreatedAt(selectedBooking.createdAt, salonTimeZone) || 'Date unavailable'}</strong>
                  </div>
                  <div className="adm-detail-row"><span>Appointment Date</span><strong>{formatDate(selectedBooking.date)}</strong></div>
                  <div className="adm-detail-row"><span>Appointment Time</span><strong>{formatTime(selectedBooking.time)}</strong></div>
                </section>

                <section className="adm-detail-card">
                  <h4>Customization</h4>
                  <div className="adm-detail-row"><span>Nail Art</span><strong>{selectedBookingNailArt.enabled ? 'Yes' : 'None'}</strong></div>
                  {selectedBookingNailArt.enabled ? (
                    <>
                      <div className="adm-detail-row"><span>Quantity</span><strong>{selectedBookingNailArt.quantity} nails</strong></div>
                      <div className="adm-detail-row"><span>Price per nail</span><strong>{formatPeso(selectedBookingNailArt.pricePerNail)}</strong></div>
                      <div className="adm-detail-row"><span>Add-on total</span><strong>{formatPeso(selectedBookingNailArt.total)}</strong></div>
                    </>
                  ) : null}
                </section>

                <section className="adm-detail-card">
                  <h4>Customer preferences</h4>
                  {selectedBookingPreferences.length > 0 ? selectedBookingPreferences.map(([label, preferenceValue]) => (
                    <div key={label} className="adm-detail-row"><span>{label}</span><strong>{preferenceValue}</strong></div>
                  )) : <p>No nail preferences saved.</p>}
                </section>

                <section className="adm-detail-card">
                  <h4>Reference photo</h4>
                  {selectedBooking.referenceImageUrl || selectedBooking.referencePhotoUrl ? (
                    <button
                      type="button"
                      className="adm-reference-thumb"
                      onClick={() => setReferencePreviewUrl(selectedBooking.referenceImageUrl || selectedBooking.referencePhotoUrl)}
                    >
                      <img src={selectedBooking.referenceImageUrl || selectedBooking.referencePhotoUrl} alt="Customer nail reference" loading="lazy" decoding="async" />
                      <span>View full image</span>
                    </button>
                  ) : <p>No reference photo.</p>}
                </section>

                <section className="adm-detail-card">
                  <h4>Customer notes</h4>
                  <p>{selectedBooking.notes || 'No additional notes.'}</p>
                </section>

                <section className="adm-detail-card adm-detail-card--pricing">
                  <h4>Pricing</h4>
                  <div className="adm-detail-row"><span>Base price</span><strong>{formatPeso(selectedBookingBasePrice)}</strong></div>
                  {selectedBookingBaseTotal !== selectedBookingBasePrice ? (
                    <div className="adm-detail-row"><span>Base total</span><strong>{formatPeso(selectedBookingBaseTotal)}</strong></div>
                  ) : null}
                  <div className="adm-detail-row"><span>Nail Art add-on</span><strong>{formatPeso(selectedBookingNailArt.total)}</strong></div>
                  <div className="adm-detail-row adm-detail-row--total"><span>Estimated total</span><strong>{formatPeso(getBookingTotal(selectedBooking))}</strong></div>
                </section>

                {selectedBookingRequest ? (
                  <section className="adm-detail-card adm-detail-card--request">
                    <h4>{selectedBookingRequest.type === 'cancellation' ? 'Cancellation request' : 'Reschedule request'}</h4>
                    <div className="adm-detail-row"><span>Requested</span><strong>{formatBookingCreatedAt(selectedBookingRequest.createdAt, salonTimeZone) || 'Recently'}</strong></div>
                    <div className="adm-detail-row"><span>Status</span><strong>{selectedBookingRequest.status === 'Pending' ? 'Pending Review' : selectedBookingRequest.status}</strong></div>
                    {selectedBookingRequest.type === 'reschedule' ? <div className="adm-detail-row"><span>Requested time</span><strong>{formatDate(selectedBookingRequest.requestedDate)} Â· {formatTime(selectedBookingRequest.requestedTime)}</strong></div> : null}
                    <div className="adm-detail-request-reason"><span>Customer reason</span><p>{selectedBookingRequest.reason || 'No reason provided.'}</p></div>
                    {selectedBookingRequest.adminReason ? <div className="adm-detail-request-reason"><span>Salon note</span><p>{selectedBookingRequest.adminReason}</p></div> : null}
                    {selectedBookingRequest.reviewedAt ? <small>Reviewed {formatBookingCreatedAt(selectedBookingRequest.reviewedAt, salonTimeZone)}</small> : null}
                    {selectedBookingRequest.status === 'Pending' ? (
                      <div className="adm-request-actions">
                        <button className="adm-btn adm-btn--primary adm-btn--sm" type="button" disabled={requestUpdatingId === selectedBookingRequest.id} onClick={() => openRequestReviewDialog(selectedBookingRequest, 'Approved')}>{requestUpdatingId === selectedBookingRequest.id ? 'Approving...' : selectedBookingRequest.type === 'cancellation' ? 'Approve cancellation' : 'Approve reschedule'}</button>
                        <button className="adm-btn adm-btn--danger adm-btn--sm" type="button" disabled={requestUpdatingId === selectedBookingRequest.id} onClick={() => openRequestReviewDialog(selectedBookingRequest, 'Declined')}>{requestUpdatingId === selectedBookingRequest.id ? 'Declining...' : 'Decline request'}</button>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section className="adm-detail-card adm-detail-card--reminders">
                  <h4>Reminders</h4>
                  <div className="adm-reminder-row">
                    <span>24-hour reminder</span>
                    <span>
                      <strong className={`is-${selectedReminder24h.tone}`}>{selectedReminder24h.label}</strong>
                      {selectedReminder24h.detail ? <small>{selectedReminder24h.detail}</small> : null}
                    </span>
                  </div>
                  <div className="adm-reminder-row">
                    <span>12-hour reminder</span>
                    <span>
                      <strong className={`is-${selectedReminder12h.tone}`}>{selectedReminder12h.label}</strong>
                      {selectedReminder12h.detail ? <small>{selectedReminder12h.detail}</small> : null}
                    </span>
                  </div>
                </section>

                <section className="adm-detail-card adm-detail-card--status">
                  <h4>Status</h4>
                  <label className="adm-status-field">
                    <span>Update appointment</span>
                    <select
                      value={normalizeBookingStatus(selectedBooking.status)}
                      disabled={statusUpdatingId === selectedBooking.id || selectedBookingRequest?.status === 'Pending'}
                      onChange={(event) => handleBookingAction(selectedBooking.id, event.target.value)}
                    >
                      {ADMIN_BOOKING_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  {statusUpdatingId === selectedBooking.id ? <p>Saving status…</p> : null}
                  {selectedBookingRequest?.status === 'Pending' ? <p>Review the pending customer request before changing this appointment status.</p> : null}
                  {selectedBooking.rewardGiven ? <p className="adm-reward-confirmation">Loyalty point awarded for this visit.</p> : null}
                </section>
              </div>
            </div>
            <div className="adm-modal-actions">
              <button className="adm-btn adm-btn--ghost" type="button" onClick={() => setSelectedBookingId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {requestReviewDialog ? (
        <div className="adm-modal-scrim adm-modal-scrim--decision" onClick={() => !requestUpdatingId && setRequestReviewDialog(null)}>
          <section className="adm-modal adm-request-decision-modal" role="dialog" aria-modal="true" aria-labelledby="request-decision-title" onClick={(event) => event.stopPropagation()}>
            <div className="adm-modal-head">
              <div>
                <h3 id="request-decision-title">{requestReviewDialog.decision === 'Approved' ? `Approve ${requestReviewDialog.request.type === 'cancellation' ? 'cancellation' : 'reschedule'}?` : `Decline ${requestReviewDialog.request.type} request?`}</h3>
                <span className="adm-modal-kicker">Confirm your decision before Firebase is updated.</span>
              </div>
              <button className="adm-icon-btn" type="button" disabled={Boolean(requestUpdatingId)} onClick={() => setRequestReviewDialog(null)} aria-label="Close request review">{I('x', 16)}</button>
            </div>
            <div className="adm-modal-body">
              <p>{requestReviewDialog.decision === 'Approved'
                ? requestReviewDialog.request.type === 'cancellation'
                  ? "This will cancel the customer's appointment, release the time slot, and stop future reminders."
                  : "This will move the confirmed appointment to the requested available time."
                : 'The appointment will remain confirmed and its time slot will stay blocked.'}</p>
              {bookingActionError ? <div className="adm-alert adm-alert--warning" role="alert">{bookingActionError}</div> : null}
              {requestReviewDialog.decision === 'Declined' ? (
                <label className="adm-field">
                  <span>Salon reason (optional)</span>
                  <textarea maxLength={500} rows={4} value={requestReviewDialog.adminReason} onChange={(event) => setRequestReviewDialog((current) => ({ ...current, adminReason: event.target.value }))} placeholder="For example: Please contact the salon directly." />
                  <small>{requestReviewDialog.adminReason.length} / 500</small>
                </label>
              ) : null}
            </div>
            <div className="adm-modal-actions">
              <button className="adm-btn adm-btn--ghost" type="button" disabled={Boolean(requestUpdatingId)} onClick={() => setRequestReviewDialog(null)}>Go back</button>
              <button className={cx('adm-btn', requestReviewDialog.decision === 'Approved' ? 'adm-btn--primary' : 'adm-btn--danger')} type="button" disabled={Boolean(requestUpdatingId)} onClick={handleAppointmentRequestDecision}>{requestUpdatingId ? requestReviewDialog.decision === 'Approved' ? 'Approving...' : 'Declining...' : requestReviewDialog.decision === 'Approved' ? 'Approve' : 'Decline request'}</button>
            </div>
          </section>
        </div>
      ) : null}

      {/* ---------------- Customer details modal ---------------- */}
      {viewingCustomer && viewingCustomerSummary && (
        <div className="adm-modal-scrim" onClick={() => setViewingUser(null)}>
          <div className="adm-modal adm-modal--wide" onClick={(e) => e.stopPropagation()}>
            <div className="adm-modal-head">
              <div>
                <h3>Customer details</h3>
                <span className="adm-modal-kicker">Profile, preferences, loyalty, and booking history</span>
              </div>
              <button className="adm-icon-btn" type="button" onClick={() => setViewingUser(null)}>{I('x', 16)}</button>
            </div>
            <div className="adm-modal-body">
              <div className="adm-detail-header">
                <span className="adm-user-avatar adm-user-avatar--lg">{initials(viewingCustomer.fullName)}</span>
                <div>
                  <strong>{viewingCustomer.fullName}</strong>
                  <span className={cx('adm-badge', viewingCustomer.status === 'active' ? 'adm-badge--active' : 'adm-badge--inactive')}>
                    {viewingCustomer.status === 'active' ? 'Active' : 'Deactivated'}
                  </span>
                </div>
              </div>

              <div className="adm-details-grid">
                <section className="adm-detail-card adm-detail-card--full">
                  <h4>Customer information</h4>
                  <div className="adm-detail-row"><span>Email</span><strong>{viewingCustomer.email || 'Not specified'}</strong></div>
                  <div className="adm-detail-row"><span>Phone</span><strong>{viewingCustomer.phone || 'Not specified'}</strong></div>
                  <div className="adm-detail-row"><span>Address</span><strong>{viewingCustomer.address || 'Not specified'}</strong></div>
                  <div className="adm-detail-row"><span>Registered</span><strong>{viewingCustomer.dateRegistered ? formatDate(viewingCustomer.dateRegistered) : 'Not available'}</strong></div>
                </section>

                <section className="adm-detail-card">
                  <h4>Nail preferences</h4>
                  {getPreferenceRows(viewingCustomer).length > 0 ? getPreferenceRows(viewingCustomer).map(([label, preferenceValue]) => (
                    <div key={label} className="adm-detail-row"><span>{label}</span><strong>{preferenceValue}</strong></div>
                  )) : <p>No nail preferences saved.</p>}
                </section>

                <section className="adm-detail-card">
                  <h4>Loyalty & rewards</h4>
                  <div className="adm-detail-row"><span>Total completed visits</span><strong>{viewingCustomerSummary.completedVisits}</strong></div>
                  <div className="adm-detail-row"><span>Unlocked rewards</span><strong>{viewingCustomerSummary.rewardsUnlocked}</strong></div>
                  <div className="adm-detail-row"><span>Available rewards</span><strong>{viewingCustomerSummary.availableRewards}</strong></div>
                  <div className="adm-detail-row"><span>Claimed rewards</span><strong>{viewingCustomerSummary.claimedRewards}</strong></div>
                  {loyaltyProgram?.active ? (
                    <div className="adm-customer-milestones">
                      {viewingCustomerSummary.milestones.map((reward) => (
                        <article className={`adm-customer-reward is-${reward.status}`} key={reward.id}>
                          <div className="adm-customer-reward-heading">
                            <div>
                              <small>{reward.requiredVisits} {reward.requiredVisits === 1 ? 'visit' : 'visits'}</small>
                              <strong>{reward.name}</strong>
                            </div>
                            <span className={cx(
                              'adm-badge',
                              reward.status === 'available' ? 'adm-badge--success' : reward.status === 'claimed' ? 'adm-badge--active' : 'adm-badge--muted'
                            )}>
                              {reward.status}
                            </span>
                          </div>
                          <p>{reward.description}</p>
                          {reward.status === 'locked' ? (
                            <p>{reward.remainingVisits} more {reward.remainingVisits === 1 ? 'visit' : 'visits'} to unlock.</p>
                          ) : null}
                          {reward.status === 'claimed' && reward.claimedAt ? (
                            <p>Claimed {formatDate(reward.claimedAt)}</p>
                          ) : null}
                          {reward.status === 'available' ? (
                            <button
                              type="button"
                              className="adm-btn adm-btn--primary adm-btn--sm adm-claim-reward-btn"
                              onClick={() => handleClaimCustomerReward(reward)}
                              disabled={claimingRewardUserId === viewingCustomer.id}
                            >
                              {claimingRewardUserId === viewingCustomer.id ? 'Claiming...' : 'Apply / mark claimed'}
                            </button>
                          ) : null}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p>No active loyalty rewards are configured.</p>
                  )}
                  {rewardActionStatus ? <p className="adm-reward-action-status" role="status">{rewardActionStatus}</p> : null}
                  {viewingCustomerSummary.rewardHistory.length > 0 ? (
                    <div className="adm-reward-history">
                      <strong>Claimed rewards</strong>
                      {viewingCustomerSummary.rewardHistory.map((reward) => (
                        <div key={reward.id}>
                          <span>{reward.rewardName}</span>
                          <small>{formatDate(reward.claimedAt)}</small>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="adm-detail-card adm-detail-card--full">
                  <h4>Upcoming appointment</h4>
                  {viewingCustomerSummary.nextAppointment ? (
                    <div className="adm-history-row">
                      <div>
                        <strong>{getBookingServiceLabel(viewingCustomerSummary.nextAppointment)}</strong>
                        <p>{formatDate(viewingCustomerSummary.nextAppointment.date)} · {formatTime(viewingCustomerSummary.nextAppointment.time)}</p>
                        {getNailArtSummary(viewingCustomerSummary.nextAppointment) ? <p>{getNailArtSummary(viewingCustomerSummary.nextAppointment)}</p> : null}
                      </div>
                      <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => {
                        setViewingUser(null);
                        handleOpenBooking(viewingCustomerSummary.nextAppointment);
                      }}>View appointment</button>
                    </div>
                  ) : <p>No upcoming appointments.</p>}
                </section>

                <section className="adm-detail-card adm-detail-card--full">
                  <h4>Booking history</h4>
                  {viewingCustomerSummary.bookings.length > 0 ? (
                    <div className="adm-history-list">
                      {viewingCustomerSummary.bookings.map((booking) => (
                        <div key={booking.id} className="adm-history-row">
                          <div>
                            <strong>{getBookingServiceLabel(booking)}</strong>
                            <p>{formatDate(booking.date)} · {formatTime(booking.time)} · {normalizeBookingStatus(booking.status)}</p>
                            {getNailArtSummary(booking) ? <p>{getNailArtSummary(booking)}</p> : null}
                            <p>Estimated total: {formatPeso(getBookingTotal(booking))}</p>
                          </div>
                          <button type="button" className="adm-btn adm-btn--ghost adm-btn--sm" onClick={() => {
                            setViewingUser(null);
                            handleOpenBooking(booking);
                          }}>View appointment</button>
                        </div>
                      ))}
                    </div>
                  ) : <p>No booking history yet.</p>}
                </section>
              </div>
            </div>
            <div className="adm-modal-actions">
              <button className="adm-btn adm-btn--ghost" type="button" onClick={() => setViewingUser(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Edit user modal ---------------- */}
      {editingUser && (
        <div className="adm-modal-scrim" onClick={() => setEditingUser(null)}>
          <div className="adm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="adm-modal-head">
              <h3>Edit user</h3>
              <button className="adm-icon-btn" type="button" onClick={() => setEditingUser(null)}>{I('x', 16)}</button>
            </div>
            <form className="adm-modal-body adm-form" onSubmit={handleSaveEditUser}>
              <label className="adm-field">
                <span>Full name</span>
                <input value={editDraft.fullName} onChange={(e) => setEditDraft((d) => ({ ...d, fullName: e.target.value }))} required />
              </label>
              <label className="adm-field">
                <span>Email address</span>
                <input type="email" value={editDraft.email} onChange={(e) => setEditDraft((d) => ({ ...d, email: e.target.value }))} required />
              </label>
              <label className="adm-field">
                <span>Contact number</span>
                <input value={editDraft.phone} onChange={(e) => setEditDraft((d) => ({ ...d, phone: e.target.value }))} placeholder="Optional" />
              </label>
              <label className="adm-field">
                <span>Address</span>
                <input value={editDraft.address || ''} onChange={(e) => setEditDraft((d) => ({ ...d, address: e.target.value }))} placeholder="Optional" />
              </label>
              <div className="adm-modal-actions">
                <button className="adm-btn adm-btn--ghost" type="button" onClick={() => setEditingUser(null)}>Cancel</button>
                <button className="adm-btn adm-btn--primary" type="submit">Save changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------- Delete confirmation modal ---------------- */}
      {deletingUser && (
        <div className="adm-modal-scrim" onClick={() => setDeletingUser(null)}>
          <div className="adm-modal adm-modal--sm" onClick={(e) => e.stopPropagation()}>
            <div className="adm-modal-head">
              <h3>Delete account</h3>
              <button className="adm-icon-btn" type="button" onClick={() => setDeletingUser(null)}>{I('x', 16)}</button>
            </div>
            <div className="adm-modal-body">
              <p>
                Are you sure you want to delete <strong>{deletingUser.fullName}</strong>'s account?
                This action cannot be undone.
              </p>
            </div>
            <div className="adm-modal-actions">
              <button className="adm-btn adm-btn--ghost" type="button" onClick={() => setDeletingUser(null)}>Cancel</button>
              <button className="adm-btn adm-btn--danger" type="button" onClick={handleConfirmDelete}>
                {I('trash', 15)} Delete account
              </button>
            </div>
          </div>
        </div>
      )}

      {referencePreviewUrl && (
        <div className="adm-image-viewer" role="dialog" aria-modal="true" aria-label="Reference photo preview" onClick={() => setReferencePreviewUrl('')}>
          <button type="button" className="adm-image-viewer-close" onClick={() => setReferencePreviewUrl('')} aria-label="Close image preview">{I('x', 20)}</button>
          <img src={referencePreviewUrl} alt="Full customer nail reference" decoding="async" onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

export default AdminPage;
