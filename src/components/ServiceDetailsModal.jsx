import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { uploadImageFile } from '../firebase';
import { formatPeso, NAIL_ART_ADD_ON } from '../constants/services';
import {
  clampNailQuantity,
  createServiceBookingSelection,
  createServicePricingFields,
  serviceRequiresNailQuantity,
  serviceSupportsNailArt,
} from '../bookingPricing';

const NAIL_QUANTITIES = Array.from({ length: 10 }, (_, index) => index + 1);
const MAX_REFERENCE_FILE_SIZE = 8 * 1024 * 1024;
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function ServiceDetailsModal({
  service,
  onClose,
  onBookService,
  initialQuantity = 1,
  initialNailArt,
  initialReferenceImageUrl = '',
}) {
  const fileInputId = useId();
  const dialogRef = useRef(null);
  const contentRef = useRef(null);
  const closeButtonRef = useRef(null);
  const fileInputRef = useRef(null);
  const objectUrlRef = useRef('');
  const openerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const isBookingRef = useRef(false);
  const [baseQuantity, setBaseQuantity] = useState(clampNailQuantity(initialQuantity));
  const [nailArtEnabled, setNailArtEnabled] = useState(initialNailArt?.enabled === true);
  const [nailArtQuantity, setNailArtQuantity] = useState(clampNailQuantity(initialNailArt?.quantity || 1));
  const [referenceFile, setReferenceFile] = useState(null);
  const [referenceImageUrl, setReferenceImageUrl] = useState(initialReferenceImageUrl);
  const [previewUrl, setPreviewUrl] = useState(initialReferenceImageUrl);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [isBooking, setIsBooking] = useState(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    isBookingRef.current = isBooking;
  }, [isBooking]);

  useLayoutEffect(() => {
    if (!service) return;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }
    setBaseQuantity(clampNailQuantity(initialQuantity));
    setNailArtEnabled(serviceSupportsNailArt(service) && initialNailArt?.enabled === true);
    setNailArtQuantity(clampNailQuantity(initialNailArt?.quantity || 1));
    setReferenceFile(null);
    setReferenceImageUrl(initialReferenceImageUrl || '');
    setPreviewUrl(initialReferenceImageUrl || '');
    setUploadProgress(0);
    setUploadError('');
    setIsBooking(false);
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
      contentRef.current.scrollLeft = 0;
    }
  }, [initialNailArt?.enabled, initialNailArt?.quantity, initialQuantity, initialReferenceImageUrl, service]);

  useEffect(() => {
    if (!service) return undefined;

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        if (!isBookingRef.current) onCloseRef.current?.();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR)];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
      window.removeEventListener('keydown', handleKeyDown);
      if (openerRef.current?.isConnected) openerRef.current.focus();
    };
  }, [service]);

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  if (!service || typeof document === 'undefined') return null;

  const requiresBaseQuantity = serviceRequiresNailQuantity(service);
  const supportsNailArt = serviceSupportsNailArt(service);
  const pricingFields = createServicePricingFields(service, baseQuantity, {
    enabled: nailArtEnabled,
    quantity: nailArtQuantity,
  });
  const hasReference = Boolean(referenceFile || referenceImageUrl);

  const replacePreviewUrl = (file) => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = file ? URL.createObjectURL(file) : '';
    setPreviewUrl(objectUrlRef.current || referenceImageUrl || '');
  };

  const handleReferenceChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('Please choose an image file.');
      return;
    }
    if (file.size > MAX_REFERENCE_FILE_SIZE) {
      setUploadError('Please choose an image smaller than 8 MB.');
      return;
    }

    setUploadError('');
    setUploadProgress(0);
    setReferenceFile(file);
    replacePreviewUrl(file);
  };

  const handleRemoveReference = () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = '';
    setReferenceFile(null);
    setReferenceImageUrl('');
    setPreviewUrl('');
    setUploadProgress(0);
    setUploadError('');
  };

  const handleReferenceButtonKeyDown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    fileInputRef.current?.click();
  };

  const handleBookService = async () => {
    setIsBooking(true);
    setUploadError('');
    let savedReferenceUrl = referenceImageUrl;

    if (referenceFile) {
      try {
        savedReferenceUrl = await uploadImageFile(referenceFile, 'booking-references', setUploadProgress);
      } catch (error) {
        console.error('Reference image upload failed', error);
        setUploadError('The reference photo could not be uploaded. Remove it to continue without a photo, or try again.');
        setIsBooking(false);
        return;
      }
    }

    const selection = createServiceBookingSelection(service, baseQuantity, {
      nailArt: {
        enabled: nailArtEnabled,
        quantity: nailArtQuantity,
      },
      referenceImageUrl: savedReferenceUrl,
    });
    onBookService?.(selection);
    onCloseRef.current?.();
  };

  return createPortal((
    <div
      className="service-details-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isBookingRef.current) onCloseRef.current?.();
      }}
    >
      <section
        ref={dialogRef}
        className="card service-details-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="service-details-title"
        aria-describedby="service-details-description"
        tabIndex="-1"
      >
        <header className="service-details-header">
          <button
            ref={closeButtonRef}
            type="button"
            className="service-details-close"
            onClick={() => onCloseRef.current?.()}
            aria-label="Close service details"
            disabled={isBooking}
          >
            &#215;
          </button>
          <span className="service-details-eyebrow">Service details</span>
          <h2 id="service-details-title">{service.title}</h2>
          <p id="service-details-description" className="service-details-description">
            {service.description || 'A carefully performed Luxe Nails service tailored to your preferred finish.'}
          </p>
          <p className="service-details-price">
            Starting at {formatPeso(service.price)}{requiresBaseQuantity ? ' / nail' : ''}
          </p>
        </header>

        <div ref={contentRef} className="service-details-content">
          <div className="service-detail-facts">
            {service.duration ? (
              <div>
                <span>Estimated duration</span>
                <strong>{service.duration}</strong>
              </div>
            ) : null}
            {service.included?.length ? (
              <div>
                <span>What&apos;s included</span>
                <ul>
                  {service.included.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </div>
            ) : null}
          </div>

          {requiresBaseQuantity ? (
            <fieldset className="service-quantity-fieldset">
              <legend>Number of nails to repair</legend>
              <div className="service-quantity-grid">
                {NAIL_QUANTITIES.map((quantity) => (
                  <button
                    type="button"
                    key={quantity}
                    className={`service-quantity-button ${baseQuantity === quantity ? 'is-selected' : ''}`}
                    onClick={() => setBaseQuantity(quantity)}
                    aria-pressed={baseQuantity === quantity}
                  >
                    {quantity}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : null}

          {supportsNailArt ? (
            <section className="service-customization" aria-labelledby="customize-set-title">
              <h3 id="customize-set-title">Customize Your Set</h3>
              <div className="service-customization-label">Add Nail Art?</div>
              <div className="service-choice-row">
                <button
                  type="button"
                  className={`service-choice-button ${!nailArtEnabled ? 'is-selected' : ''}`}
                  onClick={() => setNailArtEnabled(false)}
                  aria-pressed={!nailArtEnabled}
                >
                  No Nail Art
                </button>
                <button
                  type="button"
                  className={`service-choice-button ${nailArtEnabled ? 'is-selected' : ''}`}
                  onClick={() => setNailArtEnabled(true)}
                  aria-pressed={nailArtEnabled}
                >
                  Add Nail Art <span>{formatPeso(NAIL_ART_ADD_ON.pricePerNail)} / nail</span>
                </button>
              </div>

              {nailArtEnabled ? (
                <div className="nail-art-customization">
                  <div className="nail-art-heading">
                    <strong>{NAIL_ART_ADD_ON.title}</strong>
                    <span>{formatPeso(NAIL_ART_ADD_ON.pricePerNail)} per nail</span>
                  </div>
                  <p>{NAIL_ART_ADD_ON.description}</p>
                  <fieldset className="service-quantity-fieldset">
                    <legend>Number of nails</legend>
                    <div className="service-quantity-grid">
                      {NAIL_QUANTITIES.map((quantity) => (
                        <button
                          type="button"
                          key={quantity}
                          className={`service-quantity-button ${nailArtQuantity === quantity ? 'is-selected' : ''}`}
                          onClick={() => setNailArtQuantity(quantity)}
                          aria-pressed={nailArtQuantity === quantity}
                        >
                          {quantity}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <div className="service-details-summary nail-art-price-summary">
                    <div className="review-row"><span>Price per nail</span><strong>{formatPeso(NAIL_ART_ADD_ON.pricePerNail)}</strong></div>
                    <div className="review-row"><span>Selected</span><strong>{pricingFields.nailArt.quantity} {pricingFields.nailArt.quantity === 1 ? 'nail' : 'nails'}</strong></div>
                    <div className="review-row total"><span>Nail Art add-on</span><strong>{formatPeso(pricingFields.nailArt.total)}</strong></div>
                  </div>
                  <p className="service-pricing-note"><strong>Important:</strong> {NAIL_ART_ADD_ON.note}</p>
                </div>
              ) : null}

              <div className="service-reference-section">
                <div className="service-reference-heading">
                  <div>
                    <strong>Set Reference Photo</strong>
                    <span>Optional</span>
                  </div>
                  <p>Have a nail design in mind? Upload a reference photo for your nail tech.</p>
                </div>

                {previewUrl ? (
                  <div className="service-reference-preview">
                    <img src={previewUrl} alt="Selected nail set reference" decoding="async" />
                    <div className="service-reference-actions">
                      <label className="btn-secondary" htmlFor={fileInputId} role="button" tabIndex="0" onKeyDown={handleReferenceButtonKeyDown}>Replace</label>
                      <button type="button" className="btn-secondary" onClick={handleRemoveReference}>Remove</button>
                    </div>
                  </div>
                ) : (
                  <label className="btn-secondary service-reference-upload" htmlFor={fileInputId} role="button" tabIndex="0" onKeyDown={handleReferenceButtonKeyDown}>+ Upload Reference Photo</label>
                )}
                <input
                  id={fileInputId}
                  ref={fileInputRef}
                  className="service-reference-input"
                  type="file"
                  accept="image/*"
                  tabIndex="-1"
                  onChange={handleReferenceChange}
                />
                {uploadProgress > 0 && uploadProgress < 100 ? <p className="service-upload-status">Uploading reference photo: {uploadProgress}%</p> : null}
                {uploadError ? <p className="service-upload-error" role="alert">{uploadError}</p> : null}
              </div>
            </section>
          ) : null}

          <div className="service-details-summary service-booking-total">
            <div className="review-row"><span>Base service</span><strong>{service.title}</strong></div>
            <div className="review-row"><span>Base price</span><strong>{formatPeso(pricingFields.baseTotal)}{requiresBaseQuantity ? ` (${baseQuantity} nails)` : ''}</strong></div>
            {supportsNailArt ? (
              <>
                <div className="review-row"><span>Nail Art</span><strong>{pricingFields.nailArt.enabled ? `${pricingFields.nailArt.quantity} nails x ${formatPeso(NAIL_ART_ADD_ON.pricePerNail)}` : 'None'}</strong></div>
                {pricingFields.nailArt.enabled ? <div className="review-row"><span>Nail Art add-on</span><strong>{formatPeso(pricingFields.nailArt.total)}</strong></div> : null}
                <div className="review-row"><span>Reference photo</span><strong>{hasReference ? 'Attached ✓' : 'Not attached'}</strong></div>
              </>
            ) : null}
            <div className="review-row total"><span>Estimated total</span><strong>{formatPeso(pricingFields.estimatedTotal)}</strong></div>
          </div>

          {service.note ? <p className="service-pricing-note"><strong>Important:</strong> {service.note}</p> : null}
        </div>

        <footer className="service-details-footer">
          <button type="button" className="btn-primary service-details-book" onClick={handleBookService} disabled={isBooking} aria-busy={isBooking}>
            {isBooking ? (referenceFile ? 'Uploading Photo...' : 'Preparing Booking...') : 'Book This Service'}
          </button>
        </footer>
      </section>
    </div>
  ), document.body);
}
