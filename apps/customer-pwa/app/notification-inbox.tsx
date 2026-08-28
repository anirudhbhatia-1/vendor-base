'use client';
import { useState } from 'react';
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';
type Notice = {
  in_app_notification_id: string;
  template_key: string;
  template_payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
};
export function NotificationInbox() {
  const [token, setToken] = useState('');
  const [notices, setNotices] = useState<Notice[]>([]);
  const [message, setMessage] = useState('Use the same signed-in session token.');
  async function call(path: string, init?: RequestInit) {
    const response = await fetch(`${apiUrl}/notifications${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error(`Notification request failed (${response.status}).`);
    return response.json();
  }
  async function refresh() {
    try {
      setNotices((await call('?unread_only=false')) as Notice[]);
      setMessage('Inbox refreshed from durable local delivery receipts.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Inbox failed.');
    }
  }
  async function markRead(id: string) {
    await call(`/${id}/read`, { method: 'POST' });
    await refresh();
  }
  return (
    <section className="money-strip" aria-labelledby="notification-title">
      <div>
        <span>Local notification inbox</span>
        <strong id="notification-title">Order and support updates</strong>
        <small>{message}</small>
      </div>
      <label>
        Access token
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="nsa_…"
        />
      </label>
      <button onClick={() => void refresh()}>Refresh inbox</button>
      {notices.map((notice) => (
        <div key={notice.in_app_notification_id}>
          <strong>{notice.template_key.replaceAll('.', ' ')}</strong>
          <small>{JSON.stringify(notice.template_payload)}</small>
          {!notice.read_at && (
            <button onClick={() => void markRead(notice.in_app_notification_id)}>Mark read</button>
          )}
        </div>
      ))}
    </section>
  );
}
