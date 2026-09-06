import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  cleanPortfolioValue,
  createPortfolioBookingSelection,
  getPortfolioImage,
  getPortfolioThumbnail,
  normalizePortfolioItem,
} from '../portfolioBooking';

export default function PortfolioGallery({
  previewCount = 4,
  showFullPage = false,
  onViewFullPortfolio,
  works,
  title = 'My Works',
  className = '',
  onBookService,
}) {
  const [activeCategory, setActiveCategory] = useState('All');
  const [showAll, setShowAll] = useState(showFullPage);
  const [lightbox, setLightbox] = useState(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const lastPanRef = useRef({ x: 0, y: 0 });
  const pinchRef = useRef({ initialDistance: 0, initialScale: 1, center: null });

  const openLightbox = (w) => {
    const base = normalizePortfolioItem(w);
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setLightbox({ ...base, orientation: base.image ? '' : 'faux' });
  };

  const categories = useMemo(() => ['All', ...Array.from(new Set(
    (works || []).map((work) => cleanPortfolioValue(work.category)).filter(Boolean)
  ))], [works]);

  const visibleWorks = useMemo(() => {
    const filtered = (works || []).filter((w) => activeCategory === 'All' || w.category === activeCategory);
    return showAll ? filtered : filtered.slice(0, previewCount);
  }, [activeCategory, previewCount, showAll, works]);

  useEffect(() => {
    if (!lightbox) {
      document.body.style.overflow = '';
      setScale(1);
      setTranslate({ x: 0, y: 0 });
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };

    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [lightbox]);

  const getDistance = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  const getCenter = (t1, t2) => ({ x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 });

  const onTouchStart = (e) => {
    if (!lightbox) return;
    if (e.touches.length === 2) {
      const d = getDistance(e.touches[0], e.touches[1]);
      pinchRef.current.initialDistance = d;
      pinchRef.current.initialScale = scale || 1;
      pinchRef.current.center = getCenter(e.touches[0], e.touches[1]);
      isPanningRef.current = false;
    } else if (e.touches.length === 1 && scale > 1) {
      isPanningRef.current = true;
      lastPanRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };

  const onTouchMove = (e) => {
    if (!lightbox) return;
    if (e.touches.length === 2) {
      e.preventDefault();
      const d = getDistance(e.touches[0], e.touches[1]);
      const center = getCenter(e.touches[0], e.touches[1]);
      const newScale = Math.max(1, Math.min(4, (pinchRef.current.initialScale * d) / pinchRef.current.initialDistance));
      // compute translation to keep center stable (basic approach)
      const deltaCenter = { x: center.x - (pinchRef.current.center?.x || center.x), y: center.y - (pinchRef.current.center?.y || center.y) };
      setScale(newScale);
      setTranslate((prev) => ({ x: prev.x + deltaCenter.x * (1 - newScale / (pinchRef.current.initialScale || 1)), y: prev.y + deltaCenter.y * (1 - newScale / (pinchRef.current.initialScale || 1)) }));
      pinchRef.current.center = center;
    } else if (e.touches.length === 1 && isPanningRef.current) {
      e.preventDefault();
      const t = e.touches[0];
      const dx = t.clientX - lastPanRef.current.x;
      const dy = t.clientY - lastPanRef.current.y;
      lastPanRef.current = { x: t.clientX, y: t.clientY };
      setTranslate((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
    }
  };

  const onTouchEnd = (e) => {
    if (!lightbox) return;
    if (e.touches.length === 0) {
      isPanningRef.current = false;
      pinchRef.current.initialDistance = 0;
      pinchRef.current.center = null;
      // clamp translate when scale is 1
      if (scale <= 1) setTranslate({ x: 0, y: 0 });
    }
  };

  const onDoubleClick = () => {
    if (!lightbox) return;
    if (scale > 1) {
      setScale(1);
      setTranslate({ x: 0, y: 0 });
    } else {
      setScale(2);
    }
  };

  const clampScale = (s) => Math.max(1, Math.min(6, s));

  const zoomBy = (delta) => {
    setScale((prev) => clampScale(prev + delta));
    // when zooming, try to center image
    setTranslate({ x: 0, y: 0 });
  };

  const fitImage = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  };

  const handleBookThisLook = () => {
    if (!lightbox || !onBookService) return;
    const selection = createPortfolioBookingSelection(lightbox);
    if (!selection) return;
    setLightbox(null);
    onBookService(selection);
  };

  const renderLightboxDetails = () => (
    <aside className="lightbox-meta">
      <span className="lightbox-eyebrow">Nail details</span>
      <h3 className="lightbox-title" id="lightbox-title">{lightbox.title}</h3>
      <div className="lightbox-details-list">
        {lightbox.category ? (
          <div className="lightbox-detail">
            <span>Category</span>
            <p>{lightbox.category}</p>
          </div>
        ) : null}
        {lightbox.style ? (
          <div className="lightbox-detail">
            <span>Style</span>
            <p>{lightbox.style}</p>
          </div>
        ) : null}
        {lightbox.description ? (
          <div className="lightbox-detail lightbox-detail--description">
            <span>Description</span>
            <p>{lightbox.description}</p>
          </div>
        ) : null}
        {lightbox.shape ? (
          <div className="lightbox-detail">
            <span>Nail shape</span>
            <p>{lightbox.shape}</p>
          </div>
        ) : null}
        {lightbox.length ? (
          <div className="lightbox-detail">
            <span>Length</span>
            <p>{lightbox.length}</p>
          </div>
        ) : null}
        {lightbox.finish ? (
          <div className="lightbox-detail">
            <span>Finish</span>
            <p>{lightbox.finish}</p>
          </div>
        ) : null}
      </div>
      {onBookService ? (
        <button type="button" className="btn-primary lightbox-book-button" onClick={handleBookThisLook}>
          Book This Look
        </button>
      ) : null}
    </aside>
  );

  const showViewAllButton = !showFullPage && Boolean(onViewFullPortfolio);

  return (
    <section className={`portfolio ${className}`.trim()}>
      <div className="portfolio-header">
        <h2 className="section-title">
          <span className="script">{title}</span>
        </h2>
        {showViewAllButton && (
          <button
            className="gallery-toggle"
            onClick={() => (onViewFullPortfolio ? onViewFullPortfolio() : setShowAll((prev) => !prev))}
          >
            {onViewFullPortfolio ? 'View All' : showAll ? 'Show Less' : 'View All'}
          </button>
        )}
      </div>

      {showFullPage && (
        <div className="gallery-filters">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`filter-chip ${activeCategory === cat ? 'active' : ''}`}
              onClick={() => {
                setActiveCategory(cat);
                setShowAll(false);
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      <div className="gallery">
        {visibleWorks.length === 0 ? (
          <div className="gallery-empty-state">
            <div className="gallery-empty-icon">✦</div>
            <div>
              <strong>No works available yet</strong>
              <p>New portfolio items will appear here as soon as they are published.</p>
            </div>
          </div>
        ) : visibleWorks.map((w) => (
          <div
            key={w.id}
            className="gallery-item"
            onClick={() => openLightbox(w)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') openLightbox(w); }}
          >
            {getPortfolioImage(w) ? (
              <>
                <img
                  src={getPortfolioThumbnail(w)}
                  alt={cleanPortfolioValue(w.title) || 'Nail set'}
                  loading="lazy"
                  decoding="async"
                />
                <div className="gallery-item-overlay">
                  <div className="overlay-title">{cleanPortfolioValue(w.title) || 'Nail Set'}</div>
                  {cleanPortfolioValue(w.category) ? <div className="overlay-category">{cleanPortfolioValue(w.category)}</div> : null}
                </div>
              </>
            ) : (
              <div className="gallery-placeholder">
                <span className="gallery-placeholder-icon">✦</span>
                <span className="gallery-placeholder-title">{cleanPortfolioValue(w.title) || 'Nail Set'}</span>
                {cleanPortfolioValue(w.category) ? <span className="gallery-placeholder-category">{cleanPortfolioValue(w.category)}</span> : null}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="gallery-note">{showFullPage ? 'Filter by style and browse the full portfolio.' : 'A glimpse of signature nail art and finishes.'}</p>
      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <div className="lightbox-inner" role="dialog" aria-modal="true" aria-labelledby="lightbox-title" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="lightbox-close" onClick={() => setLightbox(null)} aria-label="Close image viewer">✕</button>
            {lightbox.image ? (
              <div className="lightbox-content">
                <div className="lightbox-visual">
                  <div className="lightbox-image-wrap">
                    <img
                      className={`lightbox-image ${lightbox.orientation || ''}`}
                      src={lightbox.image}
                      alt={lightbox.title}
                      loading="eager"
                      decoding="async"
                      onDoubleClick={onDoubleClick}
                      onTouchStart={onTouchStart}
                      onTouchMove={onTouchMove}
                      onTouchEnd={onTouchEnd}
                      style={{ transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`, touchAction: 'none' }}
                    />
                  </div>
                  <div className="lightbox-controls" aria-label="Image zoom controls">
                    <button type="button" onClick={() => zoomBy(-0.5)} aria-label="Zoom out" disabled={scale <= 1}>−</button>
                    <button type="button" onClick={() => zoomBy(0.5)} aria-label="Zoom in">+</button>
                    <button type="button" className={scale === 1 ? 'is-active' : ''} onClick={fitImage} aria-pressed={scale === 1}>Fit</button>
                  </div>
                </div>
                {renderLightboxDetails()}
              </div>
            ) : (
              <div className="lightbox-content">
                <div className="lightbox-visual">
                  <div className="lightbox-faux">
                    <span className="gallery-placeholder-icon">✦</span>
                    <span>Photo coming soon</span>
                  </div>
                </div>
                {renderLightboxDetails()}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
