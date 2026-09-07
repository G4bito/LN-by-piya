import { useMemo, useState } from 'react';
import PortfolioGallery from '../components/PortfolioGallery';
import Services from '../components/Services';
import PriceList from '../components/PriceList';
import LuxeDynamicBackground from '../components/LuxeDynamicBackground';
import { SERVICES } from '../constants/services';
import { formatWeeklyBusinessHours, normalizeBusinessSettings } from '../businessSettings';

const POPULAR_SERVICE_IDS = [
  'gel-manicure',
  'soft-gel-extensions',
  'gel-removal',
  'biab-structured-gel',
  'repair',
  'refill-for-extension',
];

const POPULAR_PRICE_IDS = [
  'gel-manicure',
  'soft-gel-extensions',
  'gel-removal',
  'biab-structured-gel',
];

const DEFAULT_BUSINESS_INFO = {
  address: import.meta.env.VITE_BUSINESS_LOCATION || '',
  hours: import.meta.env.VITE_BUSINESS_HOURS || '',
  phone: import.meta.env.VITE_BUSINESS_PHONE || '',
  email: import.meta.env.VITE_BUSINESS_EMAIL || '',
  facebookUrl: import.meta.env.VITE_BUSINESS_FACEBOOK_URL || '',
  instagramUrl: import.meta.env.VITE_BUSINESS_INSTAGRAM_URL || '',
  directionsUrl: import.meta.env.VITE_BUSINESS_DIRECTIONS_URL || '',
};

const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61591761689777';

function sortServicesByIds(ids) {
  return ids
    .map((id) => SERVICES.find((service) => service.id === id))
    .filter(Boolean);
}

function formatReviewDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function HomePage({ onBookService, onViewPortfolio, works, reviews = [], businessInfo }) {
  const [showAllServices, setShowAllServices] = useState(false);
  const [showFullPriceList, setShowFullPriceList] = useState(false);
  const popularServices = useMemo(() => sortServicesByIds(POPULAR_SERVICE_IDS), []);
  const popularPrices = useMemo(() => sortServicesByIds(POPULAR_PRICE_IDS), []);
  const displayedServices = showAllServices ? SERVICES : popularServices;
  const displayedPrices = showFullPriceList ? SERVICES : popularPrices;
  const publishedReviews = reviews.filter((review) => (
    review && (review.comment || review.message || review.review || review.reviewText)
  )).slice(0, 3);
  const normalizedBusiness = normalizeBusinessSettings({ ...DEFAULT_BUSINESS_INFO, ...(businessInfo || {}) });
  const business = { ...DEFAULT_BUSINESS_INFO, ...normalizedBusiness, ...(businessInfo || {}) };
  const facebookUrl = business.facebookUrl || FACEBOOK_URL;
  const publishedBusinessHours = business.businessHoursConfigured
    ? formatWeeklyBusinessHours(business.businessHours)
    : business.legacyBusinessHoursText || business.hours;
  const businessDetails = [
    { label: 'Location', value: business.address },
    { label: 'Contact number', value: business.phone },
    { label: 'Email', value: business.email },
  ].filter((detail) => detail.value);
  const socialLinks = [
    { label: 'Facebook', value: facebookUrl },
    { label: 'Instagram', value: business.instagramUrl },
  ].filter((link) => link.value);

  const scrollToSection = (sectionId) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };


  return (
    <div id="top" className="home-page">
      <header className="hero home-hero">
        <LuxeDynamicBackground />
        <div className="hero-content">
          <span className="eyebrow">Your nails, our art</span>
          <h1>{business.businessName}</h1>
          <p className="subtitle">Luxury {'\u00b7'} Precision {'\u00b7'} Perfection</p>
          <p className="home-hero-tagline">{business.tagline || 'Beautiful nails, designed just for you.'}</p>
          <div className="home-hero-actions">
            <button type="button" className="btn-primary" onClick={() => onBookService?.()}>
              Book Appointment
            </button>
            <button type="button" className="btn-secondary" onClick={() => scrollToSection('home-services')}>
              View Services
            </button>
          </div>
        </div>
      </header>

      <section className="page home-content">
        <div id="featured-nail-sets" className="home-section-block">
          <PortfolioGallery
            previewCount={4}
            title="Featured Nail Sets"
            className="home-featured-portfolio"
            works={works}
            onBookService={onBookService}
          />
          <div className="home-section-action">
            <button type="button" className="gallery-toggle" onClick={onViewPortfolio}>View Gallery</button>
          </div>
        </div>

        <div className="home-section-block">
          <Services
            id="home-services"
            services={displayedServices}
            onBookService={onBookService}
            showPricing
            showDetailsAction
            businessSettings={business}
          />
          <div className="home-section-action">
            <button type="button" className="gallery-toggle" onClick={() => setShowAllServices((current) => !current)}>
              {showAllServices ? 'Show Popular Services' : 'View All Services'}
            </button>
          </div>
        </div>

        <section id="popular-prices" className="card price-card home-price-card">
          <h3>{showFullPriceList ? 'Full Price List' : 'Popular Prices'}</h3>
          <PriceList services={displayedPrices} />
          <div className="home-section-action">
            <button type="button" className="gallery-toggle" onClick={() => setShowFullPriceList((current) => !current)}>
              {showFullPriceList ? 'Show Popular Prices' : 'View Full Price List'}
            </button>
          </div>
        </section>

        <section className="home-section-block" aria-labelledby="why-luxe-title">
          <h2 id="why-luxe-title" className="section-title">Why Choose Luxe Nails</h2>
          <div className="home-feature-grid">
            <article className="card home-feature-card">
              <h3>Quality Service</h3>
              <p>Carefully done nail services with attention to detail.</p>
            </article>
            <article className="card home-feature-card">
              <h3>Clean &amp; Comfortable</h3>
              <p>A clean, relaxing, and comfortable nail experience.</p>
            </article>
            <article className="card home-feature-card">
              <h3>Personalized Designs</h3>
              <p>Nail styles customized around each customer&apos;s preferences.</p>
            </article>
          </div>
        </section>

        <section id="customer-reviews" className="home-section-block" aria-labelledby="reviews-title">
          <h2 id="reviews-title" className="section-title">Customer Reviews</h2>
          {publishedReviews.length ? (
            <div className="home-review-grid">
              {publishedReviews.map((review, index) => {
                const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
                const reviewCopy = review.comment || review.message || review.review || review.reviewText;
                return (
                  <article className="card home-review-card" key={review.id || `${review.customerName || 'review'}-${index}`}>
                    <div className="home-review-stars" aria-label={`${rating} out of 5 stars`}>
                      {String.fromCharCode(9733).repeat(rating)}
                    </div>
                    <p>&ldquo;{reviewCopy}&rdquo;</p>
                    <footer>
                      <strong>{review.customerName || review.name || 'Luxe Nails customer'}</strong>
                      {review.date || review.createdAt ? <span>{formatReviewDate(review.date || review.createdAt)}</span> : null}
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="card home-empty-state">
              <strong>COMING SOON</strong>
              <p>We’re currently working on our customer review system. Soon, you’ll be able to share your experience, rate your appointment, and help others discover Luxe Nails by Piya.</p>
            </div>
          )}
        </section>

        <section className="card home-booking-cta" aria-labelledby="booking-cta-title">
          <div>
            <span className="eyebrow">Your next look awaits</span>
            <h2 id="booking-cta-title">Ready for your next nail set?</h2>
            <p>Choose your preferred service, date, and time and reserve your appointment with Luxe Nails by Piya.</p>
          </div>
          <button type="button" className="btn-primary" onClick={() => onBookService?.()}>Book Appointment</button>
        </section>

        <section id="contact" className="card home-business-card" aria-labelledby="business-title">
          <div className="home-business-heading">
            <span className="eyebrow">Plan your visit</span>
            <h2 id="business-title">Contact us</h2>
            <p>Have a question or want to book your next nail appointment? Get in touch with Luxe Nails by Piya.</p>
          </div>
          {businessDetails.length || socialLinks.length ? (
            <div className="home-business-content">
              <dl className="home-business-list">
                {businessDetails.map((detail) => (
                  <div key={detail.label}>
                    <dt>{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
                {Array.isArray(publishedBusinessHours) ? publishedBusinessHours.map((hours) => (
                  <div key={hours.label}>
                    <dt>{hours.label}</dt>
                    <dd>{hours.value}</dd>
                  </div>
                )) : publishedBusinessHours ? (
                  <div>
                    <dt>Business hours</dt>
                    <dd>{publishedBusinessHours}</dd>
                  </div>
                ) : null}
                {socialLinks.map((link) => (
                  <div key={link.label}>
                    <dt>{link.label}</dt>
                    <dd><a href={link.value} target="_blank" rel="noopener noreferrer">Visit {link.label}</a></dd>
                  </div>
                ))}
              </dl>
              {business.directionsUrl ? (
                <a className="btn-primary home-directions-button" href={business.directionsUrl} target="_blank" rel="noreferrer">
                  Get Directions
                </a>
              ) : null}
            </div>
          ) : (
            <div className="home-business-empty"><p>Business contact details have not been published yet.</p></div>
          )}
          <div className="home-contact-support" aria-labelledby="contact-support-title">
            <h3 id="contact-support-title">Having trouble with our website?</h3>
            <p>Found a bug or experiencing a problem while using the Luxe Nails website? Please send us a message through our Facebook page and tell us what happened. If possible, include a screenshot so we can check the issue.</p>
            <a className="btn-primary home-contact-support-button" href={facebookUrl} target="_blank" rel="noopener noreferrer">Message us on Facebook</a>
          </div>
        </section>
      </section>

      <footer className="home-footer">
        <div className="home-footer-inner">
          <div className="home-footer-brand">
            <strong>{business.businessName}</strong>
            <span>{business.tagline || <>Luxury {'\u00b7'} Precision {'\u00b7'} Perfection</>}</span>
          </div>
          <nav className="home-footer-links" aria-label="Footer navigation">
            <a href="#top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Home</a>
            <a href="#home-services">Services</a>
            <button type="button" onClick={onViewPortfolio}>Gallery</button>
            <button type="button" onClick={() => onBookService?.()}>Book Appointment</button>
            <a href="#contact">Contact</a>
          </nav>
          <div className="home-footer-socials">
            <a href={facebookUrl} target="_blank" rel="noopener noreferrer">Facebook</a>
            {business.instagramUrl ? <a href={business.instagramUrl} target="_blank" rel="noopener noreferrer">Instagram</a> : null}
          </div>
          <p>&copy; 2026 {business.businessName}</p>
        </div>
      </footer>
    </div>
  );
}

export default HomePage;
