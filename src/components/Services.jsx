import { useState } from 'react';
import { SERVICES, formatPeso } from '../constants/services';
import ServiceDetailsModal from './ServiceDetailsModal';

export default function Services({
  onBookService,
  services = SERVICES,
  id,
  showPricing = false,
  showDetailsAction = false,
}) {
  const [detailService, setDetailService] = useState(null);

  const serviceCardContent = (service) => (
    <>
      <div className="service-icon">{service.icon}</div>
      <div className="service-title">{service.title}</div>
      {showPricing ? <div className="service-starting-price">Starting at {formatPeso(service.price)}{service.pricingUnit === 'nail' ? ' / nail' : ''}</div> : null}
      {!showPricing && service.duration ? <div className="service-duration">{service.duration}</div> : null}
    </>
  );

  return (
    <section className="services" id={id}>
      <h2 className="section-title">Services</h2>
      <div className="services-list">
        {services.map((service) => showDetailsAction ? (
          <article key={service.id} className="service service-with-details">
            {serviceCardContent(service)}
            <button type="button" className="service-details-action" onClick={() => setDetailService(service)}>
              View details
            </button>
          </article>
        ) : (
          <button
            key={service.id}
            type="button"
            className="service"
            onClick={() => onBookService?.(service)}
          >
            {serviceCardContent(service)}
          </button>
        ))}
      </div>

      <ServiceDetailsModal
        service={detailService}
        onClose={() => setDetailService(null)}
        onBookService={onBookService}
      />
    </section>
  );
}
