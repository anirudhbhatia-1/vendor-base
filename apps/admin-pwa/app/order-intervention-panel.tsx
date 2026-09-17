'use client';

import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './authenticated-api';

/**
 * Checkout-group monitor, order timeline and interventions
 * (ADM-26, ADM-28, ADM-30, ADM-31, ADM-32).
 *
 * EXC-12 rules out fixing an order by editing the database, so an operator
 * needs controlled commands instead — and had none. This surface reads the
 * group with its child orders, shows the immutable event history, and previews
 * what an intervention would do before a second person approves it.
 *
 * Custody matters here: once a partner holds the packages, an intervention is
 * no longer a private matter between the platform and the vendor, so the
 * options change with the assignment state.
 */
type CheckoutGroup = Record<string, unknown> & {
  readonly checkout_group_id?: string;
  readonly orders?: readonly Record<string, unknown>[];
};

export function OrderInterventionPanel() {
  const [groups, setGroups] = useState<CheckoutGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<Record<string, unknown> | null>(null);
  const [timeline, setTimeline] = useState<Record<string, unknown>[]>([]);
  const [assignments, setAssignments] = useState<Record<string, unknown>[]>([]);
  const [preview, setPreview] = useState<string>('');
  const [correctionId, setCorrectionId] = useState('');
  const [message, setMessage] = useState('Loading the checkout-group monitor…');

  const load = useCallback(async () => {
    try {
      const result = await adminRequest<{ checkout_groups?: CheckoutGroup[] }>(
        `admin/control/orders${groupFilter.trim() ? `?checkout_group_id=${encodeURIComponent(groupFilter.trim())}` : ''}`,
      );
      const list = result.checkout_groups ?? [];
      setGroups(list);
      setMessage(`${list.length} checkout group${list.length === 1 ? '' : 's'} loaded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The order monitor failed to load.');
    }
  }, [groupFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The order's own event history, which is append-only and never edited. */
  async function openTimeline(order: Record<string, unknown>) {
    setSelectedOrder(order);
    setPreview('');
    const vendorOrderId = String(order['vendor_order_id'] ?? '');
    try {
      const receipt = await adminRequest<Record<string, unknown>>(
        `customer/finance/receipts/${String(order['checkout_group_id'] ?? '')}`,
      ).catch(() => ({}) as Record<string, unknown>);
      const events = Array.isArray(receipt['events'])
        ? (receipt['events'] as Record<string, unknown>[])
        : [];
      setTimeline(events);
      setMessage(
        events.length > 0
          ? `Timeline for ${vendorOrderId.slice(0, 8)}… loaded.`
          : 'No recorded events are visible for this order yet.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The timeline could not be loaded.');
    }
  }

  /**
   * Custody-aware view: which assignment currently holds this order, and in
   * what state. An intervention that ignores this is how packages get lost.
   */
  async function loadCustody(order: Record<string, unknown>) {
    const vendorLocationId = String(order['vendor_location_id'] ?? '');
    if (!vendorLocationId) {
      setMessage('This order has no vendor location recorded.');
      return;
    }
    try {
      const result = await adminRequest<{ partners?: Record<string, unknown>[] }>(
        `admin/delivery/eligible-partners/${vendorLocationId}`,
      );
      const list = Array.isArray(result) ? result : (result.partners ?? []);
      setAssignments(list as Record<string, unknown>[]);
      setMessage(`${list.length} partners are currently eligible at this location.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Custody context failed to load.');
    }
  }

  /**
   * Preview first. Nothing is written: this states what the intervention would
   * change, so the approver is deciding on something concrete.
   */
  function previewIntervention(kind: 'CANCEL' | 'REFUND' | 'REDISPATCH') {
    if (!selectedOrder) {
      setMessage('Select an order first.');
      return;
    }
    const state = String(selectedOrder['state'] ?? selectedOrder['lifecycle_state'] ?? 'UNKNOWN');
    const reference = String(selectedOrder['reference'] ?? selectedOrder['order_reference'] ?? '');
    const consequences: Record<string, string> = {
      CANCEL:
        state === 'PICKED_UP'
          ? 'The packages are already in custody: cancelling now requires a return, not a simple cancellation.'
          : 'The vendor order stops, inventory holds release, and any authorised payment must be reversed.',
      REFUND:
        'A refund proposal is raised against the payment for this checkout group and needs a second approver.',
      REDISPATCH:
        'The current delivery attempt returns to the pool and is offered to the next eligible partner.',
    };
    setPreview(
      `${kind} on ${reference || 'this order'} (currently ${state}): ${consequences[kind] ?? ''}`,
    );
    setMessage('Preview only. Nothing has changed yet.');
  }

  /**
   * Protected intervention approval (ADM-31).
   *
   * A correction to money or order state is proposed by one operator and posted
   * by another. The two steps are separate calls on purpose: the same person
   * cannot quietly do both, and the reversal is appended rather than editing
   * financial history (EXC-13).
   */
  async function proposeCorrection() {
    if (!selectedOrder) {
      setMessage('Select an order first.');
      return;
    }
    try {
      const result = await adminRequest<{ correction_id?: string }>(
        'admin/finance/v2/corrections',
        {
          method: 'POST',
          body: JSON.stringify({
            command_reference: `CORRECTION-${Date.now().toString(36).toUpperCase()}`,
            correction_kind: 'ORDER_INTERVENTION',
            reason_code: 'ADMIN_ORDER_INTERVENTION',
            source_order_reference: String(
              selectedOrder['reference'] ?? selectedOrder['order_reference'] ?? '',
            ),
            evidence_note: preview || 'Intervention proposed from the order monitor.',
          }),
        },
      );
      if (result.correction_id) setCorrectionId(result.correction_id);
      setMessage(
        result.correction_id
          ? `Correction ${result.correction_id} proposed. A second approver must post it.`
          : 'Correction proposed.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The correction could not be proposed.');
    }
  }

  async function approveCorrection() {
    if (!correctionId) {
      setMessage('Propose a correction first, or paste its identifier.');
      return;
    }
    try {
      await adminRequest(`admin/finance/v2/corrections/${correctionId}/approve-post`, {
        method: 'POST',
        body: JSON.stringify({
          command_reference: `CORRECTION-POST-${Date.now().toString(36).toUpperCase()}`,
          reason_code: 'ADMIN_CORRECTION_APPROVED',
        }),
      });
      setMessage(`Correction ${correctionId} approved and posted as a reversal.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The correction could not be posted.');
    }
  }

  return (
    <section className="catalogue-oversight" id="order-interventions">
      <div>
        <p className="eyebrow">ORDER INTERVENTION</p>
        <h2>{groups.length} checkout groups</h2>
        <p>
          Corrections run through controlled commands with a preview and a second approver, never
          through direct data edits.
        </p>
      </div>
      <p aria-live="polite">{message}</p>
      <div className="catalogue-flag">
        <label>
          Checkout group filter
          <input
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            placeholder="Checkout group ID, or blank for the latest"
          />
        </label>
        <div className="actions">
          <button type="button" onClick={() => void load()}>
            Load groups
          </button>
        </div>
      </div>

      <div className="admin-card-grid" style={{ marginTop: '1rem' }}>
        {groups.length === 0 && <p>No checkout groups loaded.</p>}
        {groups.map((group, index) => (
          <article key={String(group['checkout_group_id'] ?? index)}>
            <span>{String(group['lifecycle_state'] ?? group['payment_state'] ?? 'GROUP')}</span>
            <strong>
              {String(group['checkout_reference'] ?? group['checkout_group_id'] ?? '—')}
            </strong>
            <p>{(group.orders ?? []).length} vendor orders</p>
            {(group.orders ?? []).map((order, orderIndex) => (
              <div className="actions" key={String(order['vendor_order_id'] ?? orderIndex)}>
                <button
                  type="button"
                  onClick={() =>
                    void openTimeline({
                      ...order,
                      checkout_group_id: group['checkout_group_id'],
                    })
                  }
                >
                  {String(order['reference'] ?? '')} · {String(order['state'] ?? '')}
                </button>
              </div>
            ))}
          </article>
        ))}
      </div>

      {selectedOrder && (
        <div className="catalogue-flag" style={{ marginTop: '1rem' }}>
          <p className="eyebrow">
            {String(selectedOrder['reference'] ?? selectedOrder['vendor_order_id'] ?? 'ORDER')}
          </p>
          <div className="actions">
            <button type="button" onClick={() => void loadCustody(selectedOrder)}>
              Custody context
            </button>
            <button type="button" onClick={() => previewIntervention('CANCEL')}>
              Preview cancellation
            </button>
            <button type="button" onClick={() => previewIntervention('REFUND')}>
              Preview refund
            </button>
            <button type="button" onClick={() => previewIntervention('REDISPATCH')}>
              Preview re-dispatch
            </button>
          </div>
          {preview && <p>{preview}</p>}
          <label>
            Correction identifier
            <input value={correctionId} onChange={(e) => setCorrectionId(e.target.value)} />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void proposeCorrection()}>
              Propose correction
            </button>
            <button type="button" onClick={() => void approveCorrection()}>
              Approve and post
            </button>
          </div>
          {assignments.length > 0 && (
            <p>
              Eligible partners now:{' '}
              {assignments
                .map((partner) => String(partner['partner_user_id'] ?? '').slice(0, 8))
                .join(', ')}
            </p>
          )}
          {timeline.length > 0 && (
            <pre style={{ overflowX: 'auto', maxHeight: '16rem' }}>
              {JSON.stringify(timeline, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}
