import { Link } from 'react-router-dom';
import { formatCurrency } from '@/domain/money';
import { formatDate } from '@/lib/dates';
import type { Receivable } from '@/domain/receivables';
import { Card, EmptyState } from '@/components/ui';

/** Shared table for the outstanding / due-soon / overdue views. SPEC.md §14. */
export default function ReceivableTable({
  receivables,
  emptyTitle,
  emptyMessage,
  showDaysPastDue = true,
}: {
  receivables: Receivable[];
  emptyTitle: string;
  emptyMessage: string;
  showDaysPastDue?: boolean;
}) {
  const total = receivables.reduce((sum, r) => sum + r.amount, 0);

  return (
    <Card flush>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Customer</th>
              {/* The load number is what the customer is billed under. */}
              <th>Invoice / Load #</th>
              <th>Invoice date</th>
              <th>Due date</th>
              <th>Terms</th>
              <th className="num">{showDaysPastDue ? 'Days past due' : 'Due in'}</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {receivables.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <EmptyState title={emptyTitle} message={emptyMessage} />
                </td>
              </tr>
            )}
            {receivables.map((receivable) => (
              <tr key={receivable.shipmentId}>
                <td>
                  {receivable.customerId ? (
                    <Link
                      to={`/crm/customers/${receivable.customerId}`}
                      style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 550 }}
                    >
                      {receivable.customerName}
                    </Link>
                  ) : (
                    <span>
                      {receivable.customerName}{' '}
                      <span className="badge warn" title="Not linked to a CRM customer">
                        unlinked
                      </span>
                    </span>
                  )}
                </td>
                <td className="mono">{receivable.loadNumber || '—'}</td>
                <td className="nowrap">{formatDate(receivable.invoicedDate)}</td>
                <td className="nowrap">{formatDate(receivable.dueDate)}</td>
                <td className="muted nowrap">
                  {receivable.paymentTermsDays === 0
                    ? 'On receipt'
                    : `Net ${receivable.paymentTermsDays}`}
                </td>
                <td className="num">
                  {receivable.state === 'overdue' ? (
                    <span className="badge danger">{receivable.daysPastDue}d late</span>
                  ) : receivable.daysUntilDue === 0 ? (
                    <span className="badge warn">Today</span>
                  ) : (
                    <span className="muted">{receivable.daysUntilDue}d</span>
                  )}
                </td>
                <td className="num">{formatCurrency(receivable.amount)}</td>
              </tr>
            ))}
          </tbody>
          {receivables.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={6}>
                  {receivables.length} invoice{receivables.length === 1 ? '' : 's'}
                </td>
                <td className="num">{formatCurrency(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Card>
  );
}
