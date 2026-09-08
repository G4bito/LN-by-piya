import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getCustomerProfile, getImageUploadErrorMessage, listenToScheduleMonth, requestAppointmentReschedule, saveBooking } from '../firebase';
import { SERVICES, formatPeso } from '../constants/services';
import { isValidPhoneNumber } from '../validation';
import ServiceDetailsModal from './ServiceDetailsModal';
import {
  clampNailQuantity,
  createServicePricingFields,
  serviceRequiresNailQuantity,
  serviceSupportsNailArt,
} from '../bookingPricing';
import { SCHEDULE_CONFLICT_CODE, getServiceDurationMinutes, getUnavailableTimeSlots } from '../scheduling';
import { filterBookingServices, getCalendarCells, SERVICE_FILTERS } from '../bookingUi';
import {
  BUSINESS_WEEKDAYS,
  addDaysToDateKey,
  getBookableTimeSlots,
  getBookingDateRestriction,
  getDateKeyInTimeZone,
  groupBookingTimeSlots,
  hasReachedDailyAppointmentLimit,
  normalizeBusinessSettings,
} from '../businessSettings';

const STEPS = ['Service', 'Date & Time', 'Details', 'Confirm'];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatSlotTime(value) {
  const [hourValue = '0', minuteValue = '00'] = String(value || '').split(':');
  let hour = Number(hourValue);
  if (hourValue.length === 1 && hour > 0 && hour < 9) hour += 12;
  const period = hour >= 12 ? 'PM' : 'AM';
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minuteValue} ${period}`;
}

function formatAppointmentDate(value) {
  if (!value) return 'Not selected';
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function getInitialMonth() {
  const current = new Date();
  return new Date(current.getFullYear(), current.getMonth(), 1);
}

function getMonthKey(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function getContinueLabel(step) {
  if (step === 0) return 'Continue to Date & Time';
  if (step === 1) return 'Continue to Details';
  if (step === 2) return 'Review Booking';
  return 'Confirm Booking';
}

export default function BookingCalendar({ defaultService, user, onViewBookings, onBackHome, onEditProfile, businessSettings, rescheduleBooking }) {
  const settings = useMemo(() => normalizeBusinessSettings(businessSettings), [businessSettings]);
  const minimumStep = rescheduleBooking ? 1 : 0;
  const bookingContainerRef = useRef(null);
  const previousStepRef = useRef(defaultService?.skipServiceStep ? 1 : 0);
  const [step, setStep] = useState(defaultService?.skipServiceStep ? 1 : 0);
  const [service, setService] = useState(defaultService?.id || null);
  const [serviceFilter, setServiceFilter] = useState('All');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(getInitialMonth);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [nailQuantity, setNailQuantity] = useState(clampNailQuantity(
    defaultService?.nailQuantity ?? defaultService?.repairNailsCount ?? 1
  ));
  const [nailArtEnabled, setNailArtEnabled] = useState(defaultService?.nailArt?.enabled === true);
  const [nailArtQuantity, setNailArtQuantity] = useState(clampNailQuantity(defaultService?.nailArt?.quantity || 1, settings.maximumNailArtQuantity));
  const [referenceImageUrl, setReferenceImageUrl] = useState(defaultService?.referenceImageUrl || '');
  const [referenceImageFile, setReferenceImageFile] = useState(defaultService?.referenceImageFile || null);
  const [referencePreviewUrl, setReferencePreviewUrl] = useState('');
  const [referenceUploadProgress, setReferenceUploadProgress] = useState(0);
  const [detailService, setDetailService] = useState(() => (
    defaultService?.openCustomization ? SERVICES.find((item) => item.id === defaultService.id) || null : null
  ));
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [submittedBooking, setSubmittedBooking] = useState(null);
  const [scheduleEntries, setScheduleEntries] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityClock, setAvailabilityClock] = useState(Date.now());

  useEffect(() => {
    if (!user) return;

    const loadProfile = async () => {
      try {
        const profile = await getCustomerProfile(user.uid, user.email);
        if (profile) {
          setName(profile.fullName || profile.name || user.displayName || '');
          setEmail(profile.email || user.email || '');
          setPhone(profile.phone || '');
          setAddress(profile.address || '');
        } else {
          setName(user.displayName || '');
          setEmail(user.email || '');
        }
      } catch (profileError) {
        console.warn('Unable to load profile for booking autofill', profileError);
        setName(user.displayName || '');
        setEmail(user.email || '');
      }
    };

    loadProfile();
  }, [user]);

  const selected = SERVICES.find((item) => item.id === service);
  const visibleServices = useMemo(() => filterBookingServices(SERVICES, serviceFilter), [serviceFilter]);
  const nameRegex = /^[\p{L}' -]{2,60}$/u;
  const cleanedName = name.trim().replace(/\s+/g, ' ');
  const cleanedPhone = phone.trim().replace(/[^\d]/g, '');
  const cleanedAddress = address.trim();
  const cleanedNotes = notes.trim();
  const isPerNailService = serviceRequiresNailQuantity(selected);
  const supportsNailArt = serviceSupportsNailArt(selected, settings);
  const displayedReferenceImageUrl = referencePreviewUrl || referenceImageUrl;
  const servicePricingFields = createServicePricingFields(selected, nailQuantity, {
    enabled: nailArtEnabled,
    quantity: nailArtQuantity,
  }, settings);
  const totalPrice = servicePricingFields.totalPrice;
  const monthKey = getMonthKey(calendarMonth);
  const now = useMemo(() => new Date(availabilityClock), [availabilityClock]);
  const todayKey = useMemo(() => getDateKeyInTimeZone(now, settings.timezone), [now, settings.timezone]);
  const maximumDateKey = addDaysToDateKey(todayKey, settings.maximumAdvanceDays);
  const closedWeekdays = useMemo(() => BUSINESS_WEEKDAYS
    .filter((day) => !settings.businessHours[day.key].open || !settings.onlineBookingHours[day.key].open)
    .map((day) => day.dayIndex), [settings.businessHours, settings.onlineBookingHours]);
  const blackoutDateKeys = useMemo(() => new Set(Object.keys(settings.blackoutDates)), [settings.blackoutDates]);
  const timeSlots = useMemo(() => getBookableTimeSlots(
    date,
    selected ? getServiceDurationMinutes(selected) : 60,
    settings,
    now,
  ), [date, now, selected, settings]);
  const timeGroups = useMemo(() => groupBookingTimeSlots(timeSlots), [timeSlots]);
  const unavailableTimeSlots = useMemo(
    () => hasReachedDailyAppointmentLimit(scheduleEntries, date, settings, availabilityClock, rescheduleBooking?.id)
      ? new Set(timeSlots)
      : getUnavailableTimeSlots(timeSlots, date, selected, scheduleEntries, {
        includePendingHolds: true,
        now: availabilityClock,
        bufferMinutes: settings.appointmentBufferMinutes,
        excludeBookingId: rescheduleBooking?.id,
      }),
    [availabilityClock, date, rescheduleBooking?.id, scheduleEntries, selected, settings, timeSlots]
  );
  const fullyBookedDates = useMemo(() => {
    if (!selected) return new Set();
    const dateKeys = new Set([todayKey, ...scheduleEntries.map((entry) => entry.date).filter(Boolean)]);
    return new Set([...dateKeys].filter((dateKey) => {
      const slots = getBookableTimeSlots(dateKey, getServiceDurationMinutes(selected), settings, now);
      if (!slots.length) return !getBookingDateRestriction(dateKey, settings, now);
      return hasReachedDailyAppointmentLimit(scheduleEntries, dateKey, settings, availabilityClock, rescheduleBooking?.id)
        || getUnavailableTimeSlots(slots, dateKey, selected, scheduleEntries, {
        includePendingHolds: true,
          now: availabilityClock,
          bufferMinutes: settings.appointmentBufferMinutes,
          excludeBookingId: rescheduleBooking?.id,
      }).size === slots.length;
    }));
  }, [availabilityClock, now, rescheduleBooking?.id, scheduleEntries, selected, settings, todayKey]);
  const calendarCells = useMemo(() => getCalendarCells(calendarMonth, {
    todayKey,
    closedWeekdays,
    blackoutDates: blackoutDateKeys,
    fullyBookedDates,
    maximumDateKey,
    allowSameDayBooking: settings.allowSameDayBooking,
  }), [blackoutDateKeys, calendarMonth, closedWeekdays, fullyBookedDates, maximumDateKey, settings.allowSameDayBooking, todayKey]);
  const canNext =
    (step === 0 && Boolean(service)) ||
    (step === 1 && Boolean(date && time) && timeSlots.includes(time) && !availabilityLoading && !availabilityError && !unavailableTimeSlots.has(time)) ||
    (step === 2 && nameRegex.test(cleanedName) && isValidPhoneNumber(cleanedPhone) && cleanedAddress.length > 0 && (!isPerNailService || nailQuantity > 0));

  useEffect(() => {
    if (bookingConfirmed) return undefined;
    setAvailabilityLoading(true);
    setAvailabilityError('');
    const unsubscribe = listenToScheduleMonth(
      monthKey,
      (entries) => {
        setScheduleEntries(entries);
        setAvailabilityLoading(false);
        setAvailabilityError('');
      },
      (availabilityLoadError) => {
        console.warn('Schedule availability could not be loaded.', availabilityLoadError);
        setAvailabilityLoading(false);
        setAvailabilityError('We could not check this month right now. Please try again.');
      }
    );
    const clockTimer = window.setInterval(() => setAvailabilityClock(Date.now()), 15000);

    return () => {
      unsubscribe();
      window.clearInterval(clockTimer);
    };
  }, [bookingConfirmed, monthKey]);

  useEffect(() => {
    if (!time || (timeSlots.includes(time) && !unavailableTimeSlots.has(time))) return;
    const message = `Sorry, ${formatSlotTime(time)} is no longer available. Please select another time.`;
    setTime('');
    setError(message);
    setToast({ type: 'error', message });
  }, [time, timeSlots, unavailableTimeSlots]);

  useEffect(() => {
    if (!date || !fullyBookedDates.has(date)) return;
    setDate('');
    setTime('');
    const message = 'That date has just become fully booked. Please select another available day.';
    setError(message);
    setToast({ type: 'error', message });
  }, [date, fullyBookedDates]);

  useEffect(() => {
    if (!date) return;
    const restriction = getBookingDateRestriction(date, settings, now);
    if (!restriction) return;
    setDate('');
    setTime('');
    setError(`That date is unavailable: ${restriction}.`);
  }, [date, now, settings]);

  useEffect(() => {
    if (settings.allowReferencePhoto || (!referenceImageUrl && !referenceImageFile)) return;
    setReferenceImageUrl('');
    setReferenceImageFile(null);
  }, [referenceImageFile, referenceImageUrl, settings.allowReferencePhoto]);

  useEffect(() => {
    if (!referenceImageFile) {
      setReferencePreviewUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(referenceImageFile);
    setReferencePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [referenceImageFile]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const previousStep = previousStepRef.current;
    previousStepRef.current = step;
    if (previousStep === step || !window.matchMedia('(max-width: 768px)').matches) return undefined;

    const bookingContainer = bookingContainerRef.current;
    if (!bookingContainer) return undefined;

    const stickyHeader = document.querySelector('.navbar');
    const stickyHeaderHeight = stickyHeader?.getBoundingClientRect().height || 0;
    bookingContainer.style.scrollMarginTop = `${Math.ceil(stickyHeaderHeight + 12)}px`;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollFrame = window.requestAnimationFrame(() => {
      bookingContainer.scrollIntoView({
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });

    return () => window.cancelAnimationFrame(scrollFrame);
  }, [step]);

  const next = () => {
    setError(null);
    setStep((currentStep) => Math.min(currentStep + 1, STEPS.length - 1));
  };
  const back = () => {
    setError(null);
    setStep((currentStep) => Math.max(currentStep - 1, minimumStep));
  };

  const handleSelectService = (selectedService) => {
    const isNewService = selectedService.id !== service;
    setService(selectedService.id);
    if (isNewService) {
      setNailQuantity(1);
      setNailArtEnabled(false);
      setNailArtQuantity(1);
      setReferenceImageUrl('');
      setReferenceImageFile(null);
      setDate('');
      setTime('');
    }
    setError(null);
  };

  const handleDetailedServiceBooking = (selection) => {
    setService(selection.id);
    setNailQuantity(clampNailQuantity(selection.nailQuantity || 1));
    setNailArtEnabled(selection.nailArt?.enabled === true);
    setNailArtQuantity(clampNailQuantity(selection.nailArt?.quantity || 1, settings.maximumNailArtQuantity));
    setReferenceImageUrl(settings.allowReferencePhoto ? selection.referenceImageUrl || '' : '');
    setReferenceImageFile(settings.allowReferencePhoto ? selection.referenceImageFile || null : null);
    setDate('');
    setTime('');
    setStep(1);
    setError(null);
  };

  const handleMonthChange = (offset) => {
    setCalendarMonth((currentMonth) => new Date(currentMonth.getFullYear(), currentMonth.getMonth() + offset, 1));
    setDate('');
    setTime('');
    setError(null);
  };

  const clearFormFields = () => {
    setStep(defaultService?.skipServiceStep ? 1 : 0);
    setService(defaultService?.id || null);
    setServiceFilter('All');
    setDate('');
    setTime('');
    setCalendarMonth(getInitialMonth());
    setNotes('');
    setNailQuantity(clampNailQuantity(defaultService?.nailQuantity ?? defaultService?.repairNailsCount ?? 1));
    setNailArtEnabled(defaultService?.nailArt?.enabled === true);
    setNailArtQuantity(clampNailQuantity(defaultService?.nailArt?.quantity || 1, settings.maximumNailArtQuantity));
    setReferenceImageUrl(settings.allowReferencePhoto ? defaultService?.referenceImageUrl || '' : '');
    setReferenceImageFile(settings.allowReferencePhoto ? defaultService?.referenceImageFile || null : null);
    setReferenceUploadProgress(0);
    setStatus(null);
    setError(null);
  };

  const handleConfirm = async () => {
    if (isSaving) return;
    setError(null);
    setToast(null);

    if (!service || !date || !time) {
      setError('Please select a service, date, and time before confirming.');
      return;
    }

    if (!nameRegex.test(cleanedName) || !isValidPhoneNumber(cleanedPhone) || cleanedAddress.length === 0) {
      setError('Please enter a valid name, phone number, and address before confirming.');
      return;
    }

    setStatus('Saving your booking...');
    setIsSaving(true);

    const bookingPayload = {
      uid: user?.uid || null,
      customerName: cleanedName,
      customerPhone: cleanedPhone,
      name: cleanedName,
      phone: cleanedPhone,
      address: cleanedAddress,
      notes: cleanedNotes,
      service,
      serviceName: selected?.title || '',
      date,
      time,
      email: user?.email || email || null,
      referenceImageUrl: referenceImageUrl || '',
      referenceImageFile: settings.allowReferencePhoto ? referenceImageFile : null,
      onReferenceUploadProgress: (progress) => {
        setReferenceUploadProgress(progress);
        setStatus(progress < 100 ? `Uploading reference photo: ${progress}%` : 'Saving your booking...');
      },
      ...servicePricingFields,
    };

    try {
      let savedBooking = null;
      if (rescheduleBooking?.id) {
        await requestAppointmentReschedule(rescheduleBooking, date, time);
      } else {
        savedBooking = await saveBooking(bookingPayload);
      }
      setSubmittedBooking({ ...bookingPayload, ...savedBooking, referenceImageFile: undefined, onReferenceUploadProgress: undefined, status: rescheduleBooking ? 'Confirmed' : 'Pending Confirmation' });
      setBookingConfirmed(true);
      setStatus(null);
      setToast(null);
    } catch (saveError) {
      console.error('Booking save failed:', saveError);
      const conflictMessage = 'This date and time has already been booked. Please choose another available time.';
      const isConflict = saveError?.code === SCHEDULE_CONFLICT_CODE || String(saveError?.code || '').includes('already-exists');
      const message = isConflict
        ? conflictMessage
        : String(saveError?.code || '').startsWith('storage/')
          ? getImageUploadErrorMessage(saveError)
        : rescheduleBooking
          ? saveError?.message || 'Unable to reschedule this appointment right now. Please try again.'
          : 'Unable to complete your booking right now. Please check your connection and try again.';
      if (isConflict) {
        setTime('');
        setStep(1);
      }
      setError(message);
      setToast({ type: 'error', message });
      setStatus(null);
      setReferenceUploadProgress(0);
    } finally {
      setIsSaving(false);
    }
  };

  const resetBookingForm = () => {
    setBookingConfirmed(false);
    setSubmittedBooking(null);
    clearFormFields();
  };

  if (bookingConfirmed && submittedBooking) {
    const submittedService = SERVICES.find((item) => item.id === submittedBooking.service);
    return (
      <div className="booking-modern-card booking-success">
        <div className="success-mark" aria-hidden="true">&#10003;</div>
        <span className="booking-success-eyebrow">{rescheduleBooking ? 'Request sent' : 'Reservation saved'}</span>
        <h2>{rescheduleBooking ? 'Reschedule Request Submitted' : 'Appointment Confirmed'}</h2>
        <p>
          Your {submittedService?.title || submittedBooking.service} appointment for {formatAppointmentDate(submittedBooking.date)} at {formatSlotTime(submittedBooking.time)} was saved successfully.
        </p>
        <p className="booking-success-note">{rescheduleBooking ? 'Your original appointment and time slot stay confirmed until the salon reviews this request.' : 'The salon will notify you when the appointment is accepted by the admin.'}</p>
        <div className="booking-success-summary">
          <div className="review-row"><span>Service</span><strong>{submittedService?.title || submittedBooking.service}</strong></div>
          <div className="review-row"><span>Date</span><strong>{formatAppointmentDate(submittedBooking.date)}</strong></div>
          <div className="review-row"><span>Time</span><strong>{formatSlotTime(submittedBooking.time)}</strong></div>
          <div className="review-row total"><span>Estimated total</span><strong>{formatPeso(submittedBooking.estimatedTotal)}</strong></div>
        </div>
        <div className="booking-success-actions">
          <button type="button" className="btn-primary" onClick={onViewBookings}>View My Bookings</button>
          <button type="button" className="btn-secondary" onClick={onBackHome}>Back Home</button>
          {!rescheduleBooking ? <button type="button" className="btn-ghost" onClick={resetBookingForm}>Book Another</button> : null}
        </div>
      </div>
    );
  }

  return (
    <div ref={bookingContainerRef} className="booking-modern-card">
      <div className="stepper" aria-label="Booking progress">
        {STEPS.map((label, index) => (
          <div key={label} className="step-wrap">
            <div className={`step ${index === step ? 'active' : ''} ${index < step ? 'completed' : ''}`}>
              {index < step ? <span aria-hidden="true">&#10003;</span> : index + 1}
            </div>
            <span className="step-label">{label}</span>
            {index < STEPS.length - 1 ? <div className={`step-line ${index < step ? 'completed' : ''}`} /> : null}
          </div>
        ))}
      </div>

      <div className="booking-workspace">
        <section className="booking-main-column">
          <div className="booking-step-heading">
            <span>Step {step + 1} of {STEPS.length}</span>
            <h2>{step === 0 ? 'Select Your Service' : step === 1 ? 'Choose Your Date & Time' : step === 2 ? 'Your Details' : 'Review Your Appointment'}</h2>
            <p>
              {step === 0 && 'Select the nail service that best fits your next look.'}
              {step === 1 && 'Choose an available day and appointment time.'}
              {step === 2 && 'Confirm the contact details the salon should use.'}
              {step === 3 && 'Please check every detail before sending your request.'}
            </p>
          </div>

          <div className="step-body">
            {step === 0 ? (
              <>
                <div className="booking-service-filters" role="group" aria-label="Filter services">
                  {SERVICE_FILTERS.map((filter) => (
                    <button type="button" key={filter} className={serviceFilter === filter ? 'is-active' : ''} onClick={() => setServiceFilter(filter)} aria-pressed={serviceFilter === filter}>
                      {filter}
                    </button>
                  ))}
                </div>
                <div className="booking-service-grid">
                  {visibleServices.map((serviceItem) => {
                    const isSelected = service === serviceItem.id;
                    return (
                      <article key={serviceItem.id} className={`booking-service-card ${isSelected ? 'selected' : ''}`}>
                        {isSelected ? <span className="booking-selected-badge" aria-label="Selected"><b>&#10003;</b> Selected</span> : null}
                        <button type="button" className="booking-service-select" onClick={() => handleSelectService(serviceItem)} aria-pressed={isSelected}>
                          <span className="booking-service-icon" aria-hidden="true">{serviceItem.icon}</span>
                          <span className="booking-service-copy">
                            <strong>{serviceItem.title}</strong>
                            <small>{serviceItem.duration || 'Duration varies'}</small>
                            <span>{serviceItem.description}</span>
                          </span>
                          <span className="booking-service-price">{formatPeso(serviceItem.price)}{serviceItem.pricingUnit === 'nail' ? ' / nail' : ''}</span>
                        </button>
                        <button type="button" className="booking-service-details" onClick={() => setDetailService(serviceItem)}>View Details <span aria-hidden="true">&#8594;</span></button>
                      </article>
                    );
                  })}
                </div>
                <aside className="booking-policy-bar">
                  <strong><span aria-hidden="true">&#9201;</span> Booking policy</strong>
                  <span>{settings.appointmentPreparationNote || settings.cancellationPolicy || 'Appointments are subject to availability. Please arrive on time. Prices shown are estimates and may vary with design complexity.'}</span>
                </aside>
              </>
            ) : null}

            {step === 1 ? (
              <div className="datetime-panel">
                <section className="booking-calendar" aria-label="Appointment calendar">
                  <div className="booking-calendar-header">
                    <button type="button" onClick={() => handleMonthChange(-1)} disabled={monthKey <= getMonthKey(getInitialMonth())} aria-label="Previous month">&#8592;</button>
                    <h3>{calendarMonth.toLocaleDateString([], { month: 'long', year: 'numeric' })}</h3>
                    <button type="button" onClick={() => handleMonthChange(1)} disabled={monthKey >= maximumDateKey.slice(0, 7)} aria-label="Next month">&#8594;</button>
                  </div>
                  <div className="booking-calendar-weekdays" aria-hidden="true">
                    {WEEKDAY_LABELS.map((weekday) => <span key={weekday}>{weekday}</span>)}
                  </div>
                  <div className="booking-calendar-grid">
                    {calendarCells.map((cell, index) => cell ? (
                      <button
                        type="button"
                        key={cell.key}
                        className={`${date === cell.key ? 'is-selected' : ''} ${cell.key === todayKey ? 'is-today' : ''} ${cell.isClosed ? 'is-closed' : ''} ${cell.isBlackout ? 'is-blackout' : ''} ${cell.isFullyBooked || cell.isBeyondAdvanceWindow || cell.isSameDayUnavailable ? 'is-unavailable' : ''}`}
                        disabled={cell.disabled}
                        onClick={() => {
                          setDate(cell.key);
                          setTime('');
                          setError(null);
                        }}
                        aria-label={`${formatAppointmentDate(cell.key)}${cell.isBlackout ? `, ${settings.blackoutDates[cell.key]?.reason || 'closed'}` : cell.isClosed ? ', closed' : cell.isFullyBooked ? ', fully booked' : cell.isBeyondAdvanceWindow ? ', outside booking window' : cell.isSameDayUnavailable ? ', same-day booking unavailable' : ''}`}
                      >
                        <span>{cell.day}</span>
                        {cell.isBlackout ? <small>Closed</small> : cell.isClosed ? <small>Closed</small> : cell.isFullyBooked ? <small>Full</small> : cell.isBeyondAdvanceWindow ? <small>Unavailable</small> : cell.isSameDayUnavailable ? <small>Tomorrow</small> : null}
                      </button>
                    ) : <span className="booking-calendar-empty" key={`empty-${index}`} />)}
                  </div>
                </section>

                <section className="booking-time-panel" aria-labelledby="available-times-title">
                  <div className="booking-time-heading">
                    <h3 id="available-times-title">Available Times</h3>
                    <span>{date ? formatAppointmentDate(date) : 'Choose a date first'}</span>
                  </div>
                  {availabilityLoading ? <p className="availability-message">Checking availability...</p> : null}
                  {availabilityError ? <p className="availability-message availability-message--error">{availabilityError}</p> : null}
                  {!date ? <p className="availability-message">Choose a date to see its available times.</p> : null}
                  {date && !availabilityLoading && !availabilityError && timeGroups.length === 0 ? <p className="availability-message">No online times are available for this date.</p> : null}
                  {timeGroups.map((group) => (
                    <div className="booking-time-group" key={group.label}>
                      <strong>{group.label}</strong>
                      <div className="slot-grid">
                        {group.slots.map((slotTime) => {
                          const unavailable = unavailableTimeSlots.has(slotTime);
                          return (
                            <button
                              key={slotTime}
                              type="button"
                              className={`slot ${time === slotTime ? 'selected' : ''} ${unavailable ? 'slot--unavailable' : ''}`}
                              disabled={!date || unavailable || availabilityLoading || Boolean(availabilityError)}
                              onClick={() => {
                                setTime(slotTime);
                                setError(null);
                              }}
                            >
                              <span>{formatSlotTime(slotTime)}</span>
                              {!date ? <small>Select date</small> : unavailable ? <small>Booked</small> : <small>Available</small>}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="details-panel">
                <div className="booking-prefill-note">
                  <span>Your saved profile details are prefilled below. You can update them for this appointment.</span>
                  {onEditProfile ? <button type="button" onClick={onEditProfile}>Edit Profile</button> : null}
                </div>
                <label className="field-floating">
                  <span>Full name</span>
                  <input value={name} onChange={(event) => setName(event.target.value.replace(/[^\p{L}' -]/gu, ''))} placeholder="Juana Dela Cruz" autoComplete="name" />
                </label>
                <label className="field-floating">
                  <span>Email</span>
                  <input type="email" value={email} readOnly autoComplete="email" />
                </label>
                <label className="field-floating">
                  <span>Phone / Contact</span>
                  <input value={phone} onChange={(event) => setPhone(event.target.value.replace(/[^\d]/g, '').slice(0, 11))} placeholder="09xx xxx xxxx" inputMode="numeric" autoComplete="tel" />
                </label>
                <label className="field-floating">
                  <span>Address</span>
                  <input value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Home address" autoComplete="street-address" />
                </label>
                {isPerNailService ? (
                  <label className="field-floating">
                    <span>Number of nails</span>
                    <input type="number" min="1" max="10" value={nailQuantity} onChange={(event) => setNailQuantity(clampNailQuantity(event.target.value))} />
                  </label>
                ) : null}
                <label className="field-floating booking-notes-field">
                  <span>Notes (optional)</span>
                  <textarea value={notes} onChange={(event) => setNotes(event.target.value.slice(0, 500))} placeholder="Preferred shape, color, sensitivities, or anything your nail tech should know" rows={4} />
                </label>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="review-summary booking-final-review">
                <div className="review-row"><span>Service</span><strong>{selected?.title}</strong></div>
                <div className="review-row"><span>Duration</span><strong>{selected?.duration || 'Varies'}</strong></div>
                <div className="review-row"><span>Date</span><strong>{formatAppointmentDate(date)}</strong></div>
                <div className="review-row"><span>Time</span><strong>{formatSlotTime(time)}</strong></div>
                <div className="review-row"><span>Customer</span><strong>{cleanedName}</strong></div>
                <div className="review-row"><span>Contact</span><strong>{cleanedPhone}</strong></div>
                <div className="review-row"><span>Address</span><strong>{cleanedAddress}</strong></div>
                {isPerNailService ? <div className="review-row"><span>Nail quantity</span><strong>{nailQuantity} {nailQuantity === 1 ? 'nail' : 'nails'}</strong></div> : null}
                {supportsNailArt ? (
                  <>
                    <div className="review-row"><span>Nail Art</span><strong>{servicePricingFields.nailArt.enabled ? `${servicePricingFields.nailArt.quantity} ${servicePricingFields.nailArt.quantity === 1 ? 'nail' : 'nails'}` : 'None'}</strong></div>
                    {servicePricingFields.nailArt.enabled ? (
                      <>
                        <div className="review-row"><span>Price per nail</span><strong>{formatPeso(settings.nailArtPricePerNail)}</strong></div>
                        <div className="review-row"><span>Nail Art add-on</span><strong>{formatPeso(servicePricingFields.nailArt.total)}</strong></div>
                      </>
                    ) : null}
                    <div className="review-row booking-reference-row">
                      <span>Reference photo</span>
                      {displayedReferenceImageUrl ? <img className="booking-reference-thumbnail" src={displayedReferenceImageUrl} alt="Selected nail reference" loading="lazy" decoding="async" /> : <strong>Not attached</strong>}
                    </div>
                  </>
                ) : null}
                <div className="review-row"><span>Notes</span><strong>{cleanedNotes || 'None'}</strong></div>
                {(settings.cancellationPolicy || settings.lateArrivalPolicy || settings.noShowPolicy || settings.appointmentPreparationNote) ? (
                  <div className="booking-policy-review">
                    <strong>Appointment policies</strong>
                    {settings.cancellationPolicy ? <p><b>Cancellation:</b> {settings.cancellationPolicy}</p> : null}
                    {settings.lateArrivalPolicy ? <p><b>Late arrival:</b> {settings.lateArrivalPolicy}</p> : null}
                    {settings.noShowPolicy ? <p><b>No-show:</b> {settings.noShowPolicy}</p> : null}
                    {settings.appointmentPreparationNote ? <p><b>Before your appointment:</b> {settings.appointmentPreparationNote}</p> : null}
                  </div>
                ) : null}
                <div className="review-row total"><span>Estimated total</span><strong>{formatPeso(totalPrice)}</strong></div>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="booking-summary-panel" aria-label="Your appointment summary">
          <span className="booking-summary-eyebrow">Your Appointment</span>
          <h3>{selected?.title || 'Choose a service'}</h3>
          <div className="booking-summary-list">
            <div className="review-row"><span>Service</span><strong>{selected?.title || 'Not selected'}</strong></div>
            <div className="review-row"><span>Duration</span><strong>{selected?.duration || 'Not selected'}</strong></div>
            <div className="review-row"><span>Base price</span><strong>{selected ? `${formatPeso(selected.price)}${isPerNailService ? ' / nail' : ''}` : '--'}</strong></div>
            {isPerNailService ? <div className="review-row"><span>Quantity</span><strong>{nailQuantity} {nailQuantity === 1 ? 'nail' : 'nails'}</strong></div> : null}
            {supportsNailArt ? (
              <>
                <div className="review-row"><span>Nail Art</span><strong>{servicePricingFields.nailArt.enabled ? `${servicePricingFields.nailArt.quantity} nails x ${formatPeso(settings.nailArtPricePerNail)}` : 'None'}</strong></div>
                {servicePricingFields.nailArt.enabled ? <div className="review-row"><span>Nail Art add-on</span><strong>{formatPeso(servicePricingFields.nailArt.total)}</strong></div> : null}
              </>
            ) : <div className="review-row"><span>Nail Art</span><strong>None</strong></div>}
            <div className="review-row"><span>Reference</span><strong>{displayedReferenceImageUrl ? 'Attached ✓' : 'None'}</strong></div>
            <div className="review-row"><span>Date</span><strong>{formatAppointmentDate(date)}</strong></div>
            <div className="review-row"><span>Time</span><strong>{time ? formatSlotTime(time) : 'Not selected'}</strong></div>
            <div className="review-row total"><span>Estimated total</span><strong>{selected ? formatPeso(totalPrice) : '--'}</strong></div>
          </div>

          {error ? <div className="booking-status booking-error" role="alert">{error}</div> : status ? <div className="booking-status" role="status">{status}</div> : null}

          <div className="step-nav">
            {step > 0 ? <button type="button" className="btn-ghost" onClick={back} disabled={isSaving}>Back</button> : null}
            <button type="button" className="btn-primary" disabled={(step < STEPS.length - 1 && !canNext) || isSaving} onClick={step === STEPS.length - 1 ? handleConfirm : next} aria-busy={isSaving}>
              {isSaving
                ? referenceUploadProgress > 0 && referenceUploadProgress < 100
                  ? `Uploading photo ${referenceUploadProgress}%`
                  : 'Saving...'
                : step === STEPS.length - 1 && rescheduleBooking ? 'Confirm Reschedule' : getContinueLabel(step)}
            </button>
          </div>
          <p className="booking-secure-note"><span aria-hidden="true">&#128274;</span> Your information is secure and private.</p>
        </aside>
      </div>

      <ServiceDetailsModal
        service={detailService}
        businessSettings={settings}
        initialQuantity={service === detailService?.id ? nailQuantity : 1}
        initialNailArt={service === detailService?.id ? { enabled: nailArtEnabled, quantity: nailArtQuantity } : undefined}
        initialReferenceImageUrl={service === detailService?.id ? referenceImageUrl : ''}
        initialReferenceImageFile={service === detailService?.id ? referenceImageFile : null}
        onClose={() => setDetailService(null)}
        onBookService={handleDetailedServiceBooking}
      />

      {toast ? (
        <div className={`booking-toast ${toast.type === 'error' ? 'booking-toast--error' : 'booking-toast--success'}`} role={toast.type === 'error' ? 'alert' : 'status'}>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
