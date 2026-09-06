import { SERVICES, formatPeso } from '../constants/services';

export default function PriceList({ services = SERVICES }) {
  return (
    <ul className="price-list">
      {services.map((s) => (
        <li key={s.id} className="price-item">
          <span className="price-name">{s.title}</span>
          <span className="price-value">{formatPeso(s.price)}</span>
        </li>
      ))}
    </ul>
  );
}
