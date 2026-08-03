import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Contact, Search, Truck } from 'lucide-react';
import { useData } from '@/context/DataContext';
import { formatCurrency } from '@/domain/money';
import { formatDate } from '@/lib/dates';

interface Hit {
  id: string;
  kind: 'shipment' | 'customer' | 'agency';
  title: string;
  subtitle: string;
  link: string;
}

const MAX_PER_KIND = 6;

/** Ctrl+K palette over loads, customers and agencies. SPEC.md §17. */
export default function GlobalSearch({ onClose }: { onClose: () => void }) {
  const data = useData();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 1) return [];

    const matches = (...fields: string[]) =>
      fields.some((field) => field.toLowerCase().includes(needle));

    const shipments: Hit[] = data.shipments
      .filter((s) => matches(s.loadNumber, s.companyName, s.lane, s.carrierName, s.poc))
      .slice(0, MAX_PER_KIND)
      .map((s) => ({
        id: s.id,
        kind: 'shipment',
        title: `${s.loadNumber || 'Load'} · ${s.companyName}`,
        subtitle: `${formatDate(s.date)} · ${s.lane || 'No lane'} · ${formatCurrency(s.ar)} · ${s.status}`,
        link: `/shipments/${s.id}`,
      }));

    const customers: Hit[] = data.customers
      .filter((c) => matches(c.companyName, c.poc, c.email, c.phone))
      .slice(0, MAX_PER_KIND)
      .map((c) => ({
        id: c.id,
        kind: 'customer',
        title: c.companyName,
        subtitle: [c.poc, c.email].filter(Boolean).join(' · ') || 'No contact recorded',
        link: `/crm/customers/${c.id}`,
      }));

    const agencies: Hit[] = data.agencies
      .filter((a) => matches(a.name))
      .slice(0, MAX_PER_KIND)
      .map((a) => ({
        id: a.id,
        kind: 'agency',
        title: a.name,
        subtitle: `${a.agentPercent}/${a.agencyPercent} split`,
        link: '/agencies',
      }));

    return [...shipments, ...customers, ...agencies];
  }, [query, data.shipments, data.customers, data.agencies]);

  // Reset the cursor whenever the result set changes underneath it.
  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  function go(hit: Hit | undefined) {
    if (!hit) return;
    navigate(hit.link);
    onClose();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((index) => Math.min(index + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(hits[highlighted]);
    } else if (event.key === 'Escape') {
      onClose();
    }
  }

  const icons = { shipment: Truck, customer: Contact, agency: Building2 };

  return (
    <div
      className="modal-backdrop"
      style={{ alignItems: 'flex-start', paddingTop: 90 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="search-palette" role="dialog" aria-modal="true" aria-label="Search">
        <div className="search-input">
          <Search size={17} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search loads, customers, agencies…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="search-results">
          {query.trim().length === 0 && (
            <p className="search-empty">
              Type a load number, customer, lane or carrier.
            </p>
          )}
          {query.trim().length > 0 && hits.length === 0 && (
            <p className="search-empty">Nothing matches “{query.trim()}”.</p>
          )}
          {hits.map((hit, index) => {
            const Icon = icons[hit.kind];
            return (
              <button
                key={`${hit.kind}-${hit.id}`}
                className={index === highlighted ? 'search-hit active' : 'search-hit'}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => go(hit)}
              >
                <Icon size={15} />
                <span>
                  <strong>{hit.title}</strong>
                  <span className="muted">{hit.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
