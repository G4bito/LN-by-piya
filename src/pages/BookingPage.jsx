import BookingCalendar from '../components/BookingCalendar';
import LuxeDynamicBackground from '../components/LuxeDynamicBackground';

function BookingPage({ defaultService, user, onViewBookings, onBackHome, onEditProfile, businessSettings, rescheduleBooking }) {
  return (
    <main className="booking-page booking-page-modern">
      <LuxeDynamicBackground className="customer-page-waves" />
      <header className="hero hero-compact customer-page-hero">
        <div className="hero-content">
          <span className="eyebrow">Reserve your slot</span>
          <h1>Book an Appointment</h1>
          <p className="subtitle">Choose your service and preferred schedule</p>
        </div>
      </header>

      <section className="booking-modern-wrap">
        <BookingCalendar
          defaultService={defaultService}
          user={user}
          onViewBookings={onViewBookings}
          onBackHome={onBackHome}
          onEditProfile={onEditProfile}
          businessSettings={businessSettings}
          rescheduleBooking={rescheduleBooking}
        />
      </section>
    </main>
  );
}

export default BookingPage;
