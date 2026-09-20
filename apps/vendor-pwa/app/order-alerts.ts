/**
 * The bell on the counter (phases.md 8.1).
 *
 * The API alerts every staff member of the shop the moment an order is placed
 * (an in-app notice with `audible: true`, and a push). The console has to do
 * two things with that notice: sound, so a shop that is not staring at the
 * screen turns round, and acknowledge it, so the worker knows a person saw
 * the order and does not escalate to the owner's phone. Until audit run 49
 * the console polled a list in silence and nothing was ever acknowledged.
 */

/** An in-app notice as the API lists it. */
export interface InboxNotice {
  readonly in_app_notification_id: string;
  readonly template_key: string;
  readonly template_payload: Record<string, unknown>;
}

/** The notice the API writes for a placed order. */
export const PLACED_ORDER_ALERT = 'vendor_order_event.placed';

/**
 * Which unread alerts this console can honestly acknowledge: those for orders
 * it is showing and that still wait on a decision. An alert for another
 * location's order, or for one already answered elsewhere, is left alone so
 * it acknowledges nothing it did not show.
 */
export function alertsToAcknowledge(
  notices: readonly InboxNotice[],
  waitingOrderIds: readonly string[],
): readonly { readonly in_app_notification_id: string; readonly vendor_order_id: string }[] {
  const waiting = new Set(waitingOrderIds);
  const seen = new Set<string>();
  const result: { in_app_notification_id: string; vendor_order_id: string }[] = [];
  for (const notice of notices) {
    if (notice.template_key !== PLACED_ORDER_ALERT) continue;
    const orderId = notice.template_payload['vendor_order_id'];
    if (typeof orderId !== 'string' || !waiting.has(orderId)) continue;
    if (seen.has(notice.in_app_notification_id)) continue;
    seen.add(notice.in_app_notification_id);
    result.push({
      in_app_notification_id: notice.in_app_notification_id,
      vendor_order_id: orderId,
    });
  }
  return result;
}

/**
 * Two rising notes, synthesised so no asset has to load on a slow connection.
 *
 * Browsers refuse to sound a page nobody has touched; then the context stays
 * suspended and this returns false rather than throwing. The push alert is the
 * bell for that case -- the console's chime is for the till that is open.
 */
export function chime(): boolean {
  try {
    const Context =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return false;
    const context = new Context();
    if (context.state !== 'running') {
      void context.close();
      return false;
    }
    const start = context.currentTime;
    [880, 1174.66].forEach((hertz, index) => {
      const at = start + index * 0.18;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = hertz;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.55);
    });
    window.setTimeout(() => void context.close(), 1_500);
    return true;
  } catch {
    return false;
  }
}
