import PortfolioGallery from '../components/PortfolioGallery';

function PortfolioPage({ works, onBookService }) {
  return (
    <section className="page portfolio-page">
      <div className="hero-content" style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
        <span className="eyebrow">Featured sets</span>
        <h2>All Nail Artworks</h2>
        <p className="subtitle">Explore my all nail design sets and feel free to pick on them.</p>
      </div>
      <PortfolioGallery previewCount={8} showFullPage works={works} onBookService={onBookService} />
    </section>
  );
}

export default PortfolioPage;
