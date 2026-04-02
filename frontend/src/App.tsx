import { useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import './App.css'

type AuthState =
  | { status: 'anonymous' }
  | { status: 'authenticated'; token: string };

type Device = {
  id: number;
  name: string;
  type: string;
  status: 'busy' | 'free';
};

type TarifOption = {
  id: number;
  label: string;
  pricePer15min: number;
  minimumPrice: number;
};

type SessionStatus = 'active' | 'paused' | 'finished';

type ActiveSession = {
  id: number;
  deviceId: number;
  deviceName?: string;
  minutes: number;
  amount: number | null;
  status: SessionStatus;
};

type SessionTick = {
  sessionId: number;
  deviceId: number;
  minutes: number;
  amount: number | null;
};

type HistoryRange = 'day' | 'week' | 'month';

type SessionHistoryRow = {
  id: number;
  deviceId: number;
  deviceName: string | null;
  startTime: string;
  endTime: string | null;
  minutes: number;
  amount: number;
};

type SessionHistoryResponse = {
  range: HistoryRange;
  start: string;
  end: string;
  totalAmount: number;
  count: number;
  rows: SessionHistoryRow[];
};

type HistorySortKey = 'id' | 'device' | 'startTime' | 'endTime' | 'minutes' | 'amount';
type SortDirection = 'asc' | 'desc';

const MAX_TICK_EXTRAPOLATION_SECONDS = 8;

const API_URL = '/api';

function formatMGA(amount: number | null): string {
  if (amount == null) return '-';
  return `${new Intl.NumberFormat('fr-FR').format(amount)} MGA`;
}

function formatHHMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('fr-FR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function toDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateForFilename(value: string): string {
  return value.replaceAll('-', '');
}

function getSavedToken(): string | null {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  } catch {
    // ignore
  }
}

async function apiFetch(path: string, opts?: RequestInit, token?: string | null) {
  const headers = new Headers(opts?.headers);
  if (!headers.has('Content-Type') && opts?.body != null) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_URL}${path}`, { ...opts, headers });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && 'message' in data && (data as any).message) ||
      `${res.status} ${res.statusText}`;
    throw new Error(String(message));
  }
  return data;
}

function App() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const token = getSavedToken();
    return token ? { status: 'authenticated', token } : { status: 'anonymous' };
  });

  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refreshInFlight = useRef(false);

  const [devices, setDevices] = useState<Device[] | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [deviceType, setDeviceType] = useState('pc');

  const [sessions, setSessions] = useState<ActiveSession[] | null>(null);
  const [startDeviceId, setStartDeviceId] = useState<number | ''>('');
  const [tarifs, setTarifs] = useState<TarifOption[]>([]);
  const [isTarifModalOpen, setIsTarifModalOpen] = useState(false);
  const [isTarifFormUnlocked, setIsTarifFormUnlocked] = useState(false);
  const [tarifAccessPassword, setTarifAccessPassword] = useState('');
  const [selectedTarifId, setSelectedTarifId] = useState<number | ''>('');
  const [tarifChangePassword, setTarifChangePassword] = useState('');
  const [newTarifLabel, setNewTarifLabel] = useState('');
  const [newTarifPricePer15min, setNewTarifPricePer15min] = useState<number | ''>('');
  const [newTarifMinimumPrice, setNewTarifMinimumPrice] = useState<number | ''>('');
  const [historyRange, setHistoryRange] = useState<HistoryRange>('day');
  const [historyDate, setHistoryDate] = useState<string>(() => toDateInputValue(new Date()));
  const [history, setHistory] = useState<SessionHistoryResponse | null>(null);
  const [historySortKey, setHistorySortKey] = useState<HistorySortKey>('endTime');
  const [historySortDirection, setHistorySortDirection] = useState<SortDirection>('desc');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);

  const socketRef = useRef<Socket | null>(null);
  const [tickBySessionId, setTickBySessionId] = useState<Record<number, SessionTick>>({});
  const tickMetaRef = useRef<Record<number, { lastTickAt: number }>>({});
  const displayedSecondsRef = useRef<Record<number, number>>({});
  const lastComputedAtRef = useRef<Record<number, number>>({});
  const [now, setNow] = useState(() => Date.now());

  const freeDevices = useMemo(() => {
    if (!devices) return [];
    return devices.filter((d) => d.status === 'free');
  }, [devices]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = (await apiFetch(
        '/auth/login',
        {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        },
        null,
      )) as { token: string };
      saveToken(data.token);
      setAuth({ status: 'authenticated', token: data.token });
      setDevices(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadDevices() {
    if (auth.status !== 'authenticated') return;
    setError(null);
    setLoading(true);
    try {
      const data = (await apiFetch('/devices', undefined, auth.token)) as Device[];
      setDevices(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadSessions() {
    if (auth.status !== 'authenticated') return;
    setError(null);
    setLoading(true);
    try {
      const data = (await apiFetch(
        '/sessions/open',
        undefined,
        auth.token,
      )) as ActiveSession[];
      setSessions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function loadTarifs() {
    if (auth.status !== 'authenticated') return;
    try {
      const data = (await apiFetch('/tarifs', undefined, auth.token)) as TarifOption[];
      setTarifs(data);
    } catch {
      // silent here to avoid noisy UI while still allowing app usage
    }
  }

  async function loadHistory() {
    if (auth.status !== 'authenticated') return;
    setError(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        range: historyRange,
        date: historyDate,
      });
      const data = (await apiFetch(`/sessions/history?${qs.toString()}`, undefined, auth.token)) as SessionHistoryResponse;
      setHistory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function toggleHistorySort(key: HistorySortKey) {
    setHistoryPage(1);
    setHistorySortDirection((currentDirection) => {
      if (historySortKey !== key) {
        setHistorySortKey(key);
        return key === 'device' ? 'asc' : 'desc';
      }
      return currentDirection === 'asc' ? 'desc' : 'asc';
    });
  }

  function exportHistoryToPdf() {
    if (!history) return;
    const rows = sortedHistoryRows.map((row) => [
      String(row.id),
      row.deviceName ?? `#${row.deviceId}`,
      formatDateTime(row.startTime),
      formatDateTime(row.endTime),
      formatHHMMSS(row.minutes * 60),
      formatMGA(row.amount),
    ]);

    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    doc.setFontSize(12);
    doc.text(`Historique sessions (${historyRange}) - ${historyDate}`, 40, 32);
    doc.setFontSize(10);
    doc.text(
      `Sessions: ${history.count} | Total: ${formatMGA(history.totalAmount)}`,
      40,
      50,
    );

    autoTable(doc, {
      startY: 62,
      head: [['ID', 'Device', 'Début', 'Fin', 'Durée', 'Montant']],
      body: rows,
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [45, 55, 72] },
      theme: 'grid',
    });

    doc.save(`historique-sessions-${historyRange}-${formatDateForFilename(historyDate)}.pdf`);
  }

  async function startSession(e: React.FormEvent) {
    e.preventDefault();
    if (auth.status !== 'authenticated') return;
    if (startDeviceId === '') return;
    setError(null);
    setLoading(true);
    try {
      await apiFetch(
        '/sessions/start',
        {
          method: 'POST',
          body: JSON.stringify({
            deviceId: startDeviceId,
          }),
        },
        auth.token,
      );
      setStartDeviceId('');
      await Promise.all([loadDevices(), loadSessions()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function sessionAction(sessionId: number, action: 'pause' | 'resume' | 'stop') {
    if (auth.status !== 'authenticated') return;
    setError(null);
    setLoading(true);
    try {
      await apiFetch(`/sessions/${sessionId}/${action}`, { method: 'POST' }, auth.token);
      await Promise.all([loadDevices(), loadSessions()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function generateSessionPassword(sessionId: number) {
    if (auth.status !== 'authenticated') return;
    setError(null);
    setLoading(true);
    try {
      const data = (await apiFetch(
        `/sessions/${sessionId}/password`,
        { method: 'POST' },
        auth.token,
      )) as { password: string };
      alert(`Mot de passe: ${data.password}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function createDevice(e: React.FormEvent) {
    e.preventDefault();
    if (auth.status !== 'authenticated') return;
    setError(null);
    setLoading(true);
    try {
      await apiFetch(
        '/devices',
        {
          method: 'POST',
          body: JSON.stringify({ name: deviceName, type: deviceType }),
        },
        auth.token,
      );
      setDeviceName('');
      await loadDevices();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function applyGlobalTarif(tarifId: number) {
    if (auth.status !== 'authenticated') return;
    if (!tarifChangePassword.trim()) {
      setError('Mot de passe requis pour changer le tarif');
      return;
    }
    await apiFetch(
      '/sessions/tarif/global',
      {
        method: 'PUT',
        body: JSON.stringify({
          tarifId,
          password: tarifChangePassword,
        }),
      },
      auth.token,
    );
    await Promise.all([loadSessions(), loadHistory()]);
  }

  async function changeSessionTarif(e: React.FormEvent) {
    e.preventDefault();
    if (auth.status !== 'authenticated') return;
    if (selectedTarifId === '') return;

    setError(null);
    setLoading(true);
    try {
      await applyGlobalTarif(selectedTarifId);
      setIsTarifModalOpen(false);
      setIsTarifFormUnlocked(false);
      setTarifAccessPassword('');
      setSelectedTarifId('');
      setTarifChangePassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function createTarif(applyNow: boolean) {
    if (auth.status !== 'authenticated') return;
    if (!newTarifLabel.trim()) {
      setError('Le nom du tarif est requis');
      return;
    }
    if (newTarifPricePer15min === '' || newTarifMinimumPrice === '') {
      setError('Prix/15min et minimum requis');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const created = (await apiFetch(
        '/tarifs',
        {
          method: 'POST',
          body: JSON.stringify({
            label: newTarifLabel.trim(),
            pricePer15min: newTarifPricePer15min,
            minimumPrice: newTarifMinimumPrice,
          }),
        },
        auth.token,
      )) as TarifOption;
      await loadTarifs();
      setSelectedTarifId(created.id);
      if (applyNow) {
        await applyGlobalTarif(created.id);
      }
      setNewTarifLabel('');
      setNewTarifPricePer15min('');
      setNewTarifMinimumPrice('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function openTarifModal() {
    setIsTarifModalOpen(true);
    setIsTarifFormUnlocked(false);
    setTarifAccessPassword('');
    setSelectedTarifId(tarifs[0]?.id ?? '');
    setTarifChangePassword('');
    setNewTarifLabel('');
    setNewTarifPricePer15min('');
    setNewTarifMinimumPrice('');
    setError(null);
  }

  function unlockTarifForm(e: React.FormEvent) {
    e.preventDefault();
    if (tarifAccessPassword !== 'Dola2851') {
      setError('Mot de passe invalide');
      return;
    }
    setError(null);
    setIsTarifFormUnlocked(true);
    setTarifChangePassword(tarifAccessPassword);
  }

  function logout() {
    saveToken(null);
    setAuth({ status: 'anonymous' });
    setDevices(null);
    setSessions(null);
    setTarifs([]);
    setHistory(null);
    setTickBySessionId({});
    tickMetaRef.current = {};
    socketRef.current?.disconnect();
    socketRef.current = null;
    setError(null);
  }

  useEffect(() => {
    if (auth.status !== 'authenticated') return;

    let cancelled = false;

    async function refreshOnce() {
      if (cancelled) return;
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      try {
        await Promise.all([loadDevices(), loadSessions(), loadHistory(), loadTarifs()]);
      } finally {
        refreshInFlight.current = false;
      }
    }

    void refreshOnce();
    const id = window.setInterval(() => void refreshOnce(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, auth.status === 'authenticated' ? auth.token : null, historyRange, historyDate]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;

    const socket = io(API_URL, { transports: ['websocket'] });
    socketRef.current = socket;

    function refreshOnceSafe() {
      if (refreshInFlight.current) return;
      refreshInFlight.current = true;
      Promise.all([loadDevices(), loadSessions(), loadHistory(), loadTarifs()])
        .catch(() => {})
        .finally(() => {
          refreshInFlight.current = false;
        });
    }

    socket.on('session:tick', (payload: SessionTick) => {
      tickMetaRef.current[payload.sessionId] = { lastTickAt: Date.now() };
      setTickBySessionId((m) => ({ ...m, [payload.sessionId]: payload }));
    });
    socket.on('session:started', (p: { sessionId: number }) => {
      delete tickMetaRef.current[p.sessionId];
      delete lastComputedAtRef.current[p.sessionId];
      refreshOnceSafe();
    });
    socket.on('session:paused', (p: { sessionId: number }) => {
      delete tickMetaRef.current[p.sessionId];
      delete lastComputedAtRef.current[p.sessionId];
      setTickBySessionId((m) => {
        const copy = { ...m };
        delete copy[p.sessionId];
        return copy;
      });
      refreshOnceSafe();
    });
    socket.on('session:resumed', (p: { sessionId: number }) => {
      // Drop stale tick references from a previous active window.
      delete tickMetaRef.current[p.sessionId];
      delete lastComputedAtRef.current[p.sessionId];
      setTickBySessionId((m) => {
        const copy = { ...m };
        delete copy[p.sessionId];
        return copy;
      });
      refreshOnceSafe();
    });
    socket.on('session:stopped', (p: { sessionId: number }) => {
      delete tickMetaRef.current[p.sessionId];
      delete lastComputedAtRef.current[p.sessionId];
      delete displayedSecondsRef.current[p.sessionId];
      setTickBySessionId((m) => {
        const copy = { ...m };
        delete copy[p.sessionId];
        return copy;
      });
      refreshOnceSafe();
    });
    socket.on('session:updated', refreshOnceSafe);

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, auth.status === 'authenticated' ? auth.token : null, historyRange, historyDate]);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [auth.status]);

  useEffect(() => {
    const currentIds = new Set((sessions ?? []).map((s) => s.id));
    for (const key of Object.keys(displayedSecondsRef.current)) {
      const id = Number(key);
      if (!currentIds.has(id)) {
        delete displayedSecondsRef.current[id];
        delete lastComputedAtRef.current[id];
      }
    }
  }, [sessions]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyRange, historyDate]);

  const sessionSecondsById = useMemo(() => {
    if (!sessions) return {};
    const out: Record<number, number> = {};
    for (const s of sessions) {
      const tick = tickBySessionId[s.id];
      const baseMinutes = tick?.minutes ?? s.minutes;
      const lastTickAt = tickMetaRef.current[s.id]?.lastTickAt ?? now;
      const isActive = s.status === 'active';
      const elapsedSinceTick = Math.max(0, (now - lastTickAt) / 1000);
      const elapsedSeconds =
        isActive && tick
          ? Math.min(elapsedSinceTick, MAX_TICK_EXTRAPOLATION_SECONDS)
          : 0;
      const candidateSeconds = baseMinutes * 60 + elapsedSeconds;
      const previousSeconds = displayedSecondsRef.current[s.id] ?? candidateSeconds;
      const previousComputedAt = lastComputedAtRef.current[s.id] ?? now;
      const localDeltaSeconds = Math.min(Math.max(0, (now - previousComputedAt) / 1000), 2);

      // Advance smoothly each second for active sessions, and keep monotonic
      // when backend refresh returns rounded minute values.
      const optimisticSeconds = isActive ? previousSeconds + localDeltaSeconds : previousSeconds;
      const nextSeconds = Math.max(candidateSeconds, optimisticSeconds);

      displayedSecondsRef.current[s.id] = nextSeconds;
      lastComputedAtRef.current[s.id] = now;
      out[s.id] = nextSeconds;
    }
    return out;
  }, [now, sessions, tickBySessionId]);

  const sortedHistoryRows = useMemo(() => {
    if (!history) return [];
    const dir = historySortDirection === 'asc' ? 1 : -1;
    const rows = [...history.rows];
    rows.sort((a, b) => {
      switch (historySortKey) {
        case 'id':
          return (a.id - b.id) * dir;
        case 'device': {
          const av = (a.deviceName ?? `#${a.deviceId}`).toLowerCase();
          const bv = (b.deviceName ?? `#${b.deviceId}`).toLowerCase();
          return av.localeCompare(bv) * dir;
        }
        case 'startTime':
          return (new Date(a.startTime).getTime() - new Date(b.startTime).getTime()) * dir;
        case 'endTime':
          return (new Date(a.endTime ?? 0).getTime() - new Date(b.endTime ?? 0).getTime()) * dir;
        case 'minutes':
          return (a.minutes - b.minutes) * dir;
        case 'amount':
          return (a.amount - b.amount) * dir;
        default:
          return 0;
      }
    });
    return rows;
  }, [history, historySortDirection, historySortKey]);

  const historyPageCount = useMemo(() => {
    if (!sortedHistoryRows.length) return 1;
    return Math.max(1, Math.ceil(sortedHistoryRows.length / historyPageSize));
  }, [sortedHistoryRows.length, historyPageSize]);

  useEffect(() => {
    if (historyPage > historyPageCount) {
      setHistoryPage(historyPageCount);
    }
  }, [historyPage, historyPageCount]);

  const paginatedHistoryRows = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize;
    const end = start + historyPageSize;
    return sortedHistoryRows.slice(start, end);
  }, [historyPage, historyPageSize, sortedHistoryRows]);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <div className="brandTitle">Tarification par usage fait par Rasamiarivelo Dola Mahenintsoa</div>
        </div>
        {auth.status === 'authenticated' ? (
          <button className="btn" onClick={logout}>
            Logout
          </button>
        ) : null}
      </header>

      <main className="content">
        {auth.status === 'anonymous' ? (
          <section className="card max-w-md mx-auto">
            <h2 className="text-2xl font-bold text-center mb-6">Connexion</h2>
            <form className="form space-y-4" onSubmit={login}>
              <label className="field block">
                <span className="block text-sm font-medium text-gray-700 mb-2">Email</span>
                <input 
                  value={email} 
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="admin@example.com"
                />
              </label>
              <label className="field block">
                <span className="block text-sm font-medium text-gray-700 mb-2">Mot de passe</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="admin"
                />
              </label>
              <button 
                className="btn primary w-full py-3 px-4 rounded-lg font-medium disabled:opacity-50" 
                disabled={loading}
              >
                {loading ? 'Connexion...' : 'Se connecter'}
              </button>
            </form>
            {error ? <div className="error mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded-lg">{error}</div> : null}
          </section>
        ) : (
          <>
            <section className="card">
              <div className="row">
                <h2>Devices</h2>
                <div className="row">
                  <button className="btn" onClick={loadDevices} disabled={loading}>
                    Rafraîchir
                  </button>
                </div>
              </div>

              <form className="form rowWrap" onSubmit={createDevice}>
                <label className="field">
                  <span>Nom</span>
                  <input
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    placeholder="PC 01"
                    required
                  />
                </label>
                <label className="field">
                  <span>Type</span>
                  <input
                    value={deviceType}
                    onChange={(e) => setDeviceType(e.target.value)}
                    placeholder="pc"
                    required
                  />
                </label>
                <button className="btn primary" disabled={loading}>
                  Ajouter
                </button>
              </form>

              {error ? <div className="error">{error}</div> : null}

              {devices == null ? (
                <div className="muted">Clique “Rafraîchir” pour charger la liste.</div>
              ) : devices.length === 0 ? (
                <div className="muted">Aucun device. Ajoute-en un au-dessus.</div>
              ) : (
                <div className="table">
                  <div className="thead">
                    <div>ID</div>
                    <div>Nom</div>
                    <div>Type</div>
                    <div>Status</div>
                  </div>
                  {devices.map((d) => (
                    <div className="trow" key={d.id}>
                      <div>{d.id}</div>
                      <div>{d.name}</div>
                      <div>{d.type}</div>
                      <div>{d.status}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card">
              <div className="row">
                <h2>Sessions</h2>
                <div className="row">
                  <button className="btn" onClick={openTarifModal} disabled={loading || tarifs.length === 0}>
                    Changer tarif global
                  </button>
                  <button className="btn" onClick={loadSessions} disabled={loading}>
                    Rafraîchir
                  </button>
                </div>
              </div>

              <form className="form rowWrap" onSubmit={startSession}>
                <label className="field">
                  <span>Device (free)</span>
                  <select
                    value={startDeviceId}
                    onChange={(e) =>
                      setStartDeviceId(e.target.value ? Number(e.target.value) : '')
                    }
                    required
                  >
                    <option value="">Sélectionner…</option>
                    {freeDevices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} (#{d.id})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Tarif</span>
                  <input value="Par défaut (automatique)" disabled />
                </label>
                <button className="btn primary" disabled={loading}>
                  Démarrer session
                </button>
              </form>

              {error ? <div className="error">{error}</div> : null}

              {sessions == null ? (
                <div className="muted">Clique “Rafraîchir” pour charger les sessions actives.</div>
              ) : sessions.length === 0 ? (
                <div className="muted">Aucune session active.</div>
              ) : (
                <div className="table">
                  <div className="thead sessionsHead">
                    <div>ID</div>
                    <div>Device</div>
                    <div>Minuteur</div>
                    <div>Coût</div>
                    <div>Status</div>
                    <div>Actions</div>
                  </div>
                  {sessions.map((s) => (
                    <div className="trow sessionsRow" key={s.id}>
                      <div>{s.id}</div>
                      <div>
                        {s.deviceName ?? `#${s.deviceId}`} <span className="mutedInline">({s.deviceId})</span>
                      </div>
                      <div>{formatHHMMSS(sessionSecondsById[s.id] ?? s.minutes * 60)}</div>
                      <div>{formatMGA(tickBySessionId[s.id]?.amount ?? s.amount)}</div>
                      <div>{s.status}</div>
                      <div className="actions">
                        {s.status === 'active' ? (
                          <button
                            className="btn"
                            onClick={() => sessionAction(s.id, 'pause')}
                            disabled={loading}
                          >
                            Pause
                          </button>
                        ) : null}
                        {s.status === 'paused' ? (
                          <button
                            className="btn"
                            onClick={() => sessionAction(s.id, 'resume')}
                            disabled={loading}
                          >
                            Resume
                          </button>
                        ) : null}
                        <button
                          className="btn"
                          onClick={() => sessionAction(s.id, 'stop')}
                          disabled={loading}
                        >
                          Stop
                        </button>
                        <button
                          className="btn"
                          onClick={() => generateSessionPassword(s.id)}
                          disabled={loading}
                        >
                          Password
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card">
              <div className="row">
                <h2>Historique des sessions</h2>
                <div className="row">
                  <button className="btn" onClick={exportHistoryToPdf} disabled={loading || !history}>
                    Export PDF
                  </button>
                  <button className="btn" onClick={loadHistory} disabled={loading}>
                    Rafraîchir
                  </button>
                </div>
              </div>

              <form
                className="form rowWrap"
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadHistory();
                }}
              >
                <label className="field">
                  <span>Période</span>
                  <select
                    value={historyRange}
                    onChange={(e) => setHistoryRange(e.target.value as HistoryRange)}
                  >
                    <option value="day">Jour</option>
                    <option value="week">Semaine</option>
                    <option value="month">Mois</option>
                  </select>
                </label>

                <label className="field">
                  <span>Date d’ancrage</span>
                  <input
                    type="date"
                    value={historyDate}
                    onChange={(e) => setHistoryDate(e.target.value)}
                    required
                  />
                </label>

                <button className="btn primary" disabled={loading}>
                  Filtrer
                </button>
              </form>

              {history ? (
                <div className="rowWrap historySummary">
                  <div className="summaryChip">Sessions: {history.count}</div>
                  <div className="summaryChip">Total: {formatMGA(history.totalAmount)}</div>
                </div>
              ) : null}

              {error ? <div className="error">{error}</div> : null}

              {history == null ? (
                <div className="muted">Clique “Rafraîchir” pour charger l’historique.</div>
              ) : history.rows.length === 0 ? (
                <div className="muted">Aucune session arrêtée sur cette période.</div>
              ) : (
                <div className="table">
                  <div className="thead historyHead">
                    <button className="sortBtn" onClick={() => toggleHistorySort('id')}>ID</button>
                    <button className="sortBtn" onClick={() => toggleHistorySort('device')}>Device</button>
                    <button className="sortBtn" onClick={() => toggleHistorySort('startTime')}>Début</button>
                    <button className="sortBtn" onClick={() => toggleHistorySort('endTime')}>Fin</button>
                    <button className="sortBtn" onClick={() => toggleHistorySort('minutes')}>Durée</button>
                    <button className="sortBtn" onClick={() => toggleHistorySort('amount')}>Montant</button>
                  </div>
                  {paginatedHistoryRows.map((row) => (
                    <div className="trow historyRow" key={row.id}>
                      <div>{row.id}</div>
                      <div>
                        {row.deviceName ?? `#${row.deviceId}`} <span className="mutedInline">({row.deviceId})</span>
                      </div>
                      <div>{formatDateTime(row.startTime)}</div>
                      <div>{formatDateTime(row.endTime)}</div>
                      <div>{formatHHMMSS(row.minutes * 60)}</div>
                      <div>{formatMGA(row.amount)}</div>
                    </div>
                  ))}
                </div>
              )}

              {history && history.rows.length > 0 ? (
                <div className="rowWrap historyPager">
                  <label className="field pagerField">
                    <span>Lignes/page</span>
                    <select
                      value={historyPageSize}
                      onChange={(e) => {
                        setHistoryPageSize(Number(e.target.value));
                        setHistoryPage(1);
                      }}
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={20}>20</option>
                      <option value={50}>50</option>
                    </select>
                  </label>
                  <div className="summaryChip">
                    Page {historyPage} / {historyPageCount}
                  </div>
                  <button
                    className="btn"
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    disabled={historyPage <= 1}
                  >
                    Précédent
                  </button>
                  <button
                    className="btn"
                    onClick={() => setHistoryPage((p) => Math.min(historyPageCount, p + 1))}
                    disabled={historyPage >= historyPageCount}
                  >
                    Suivant
                  </button>
                </div>
              ) : null}
            </section>

            {isTarifModalOpen ? (
              <div className="modalOverlay" onClick={() => setIsTarifModalOpen(false)}>
                <div className="modalCard" onClick={(e) => e.stopPropagation()}>
                  <h3>Changer le tarif global</h3>
                  {!isTarifFormUnlocked ? (
                    <form className="form" onSubmit={unlockTarifForm}>
                      <label className="field">
                        <span>Mot de passe d’accès</span>
                        <input
                          type="password"
                          value={tarifAccessPassword}
                          onChange={(e) => setTarifAccessPassword(e.target.value)}
                          placeholder="Entrer le mot de passe"
                          required
                        />
                      </label>
                      <div className="row">
                        <button className="btn" type="button" onClick={() => setIsTarifModalOpen(false)}>
                          Annuler
                        </button>
                        <button className="btn primary" disabled={loading}>
                          Valider
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form className="form" onSubmit={changeSessionTarif}>
                      <label className="field">
                        <span>Nouveau tarif (appliqué à toutes les sessions ouvertes)</span>
                        <select
                          value={selectedTarifId}
                          onChange={(e) =>
                            setSelectedTarifId(e.target.value ? Number(e.target.value) : '')
                          }
                          required
                        >
                          <option value="">Sélectionner…</option>
                          {tarifs.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.label} - 15min: {formatMGA(t.pricePer15min)} / min: {formatMGA(t.minimumPrice)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="row">
                        <button className="btn primary" type="submit" disabled={loading || selectedTarifId === ''}>
                          Appliquer la sélection
                        </button>
                      </div>
                      <div className="cardInset">
                        <div className="form">
                          <h4>Ajouter un nouveau tarif</h4>
                          <label className="field">
                            <span>Nom du tarif</span>
                            <input
                              value={newTarifLabel}
                              onChange={(e) => setNewTarifLabel(e.target.value)}
                              placeholder="ex: premium"
                              required
                            />
                          </label>
                          <label className="field">
                            <span>Prix pour 15 min (MGA)</span>
                            <input
                              type="number"
                              value={newTarifPricePer15min === '' ? '' : String(newTarifPricePer15min)}
                              onChange={(e) =>
                                setNewTarifPricePer15min(e.target.value ? Number(e.target.value) : '')
                              }
                              min={1}
                              required
                            />
                          </label>
                          <label className="field">
                            <span>Prix minimum (MGA)</span>
                            <input
                              type="number"
                              value={newTarifMinimumPrice === '' ? '' : String(newTarifMinimumPrice)}
                              onChange={(e) =>
                                setNewTarifMinimumPrice(e.target.value ? Number(e.target.value) : '')
                              }
                              min={0}
                              required
                            />
                          </label>
                          <button className="btn" type="button" onClick={() => void createTarif(false)} disabled={loading}>
                            Ajouter ce tarif
                          </button>
                          <button
                            className="btn primary"
                            type="button"
                            onClick={() => void createTarif(true)}
                            disabled={loading}
                          >
                            Ajouter et appliquer
                          </button>
                        </div>
                      </div>
                      <div className="row">
                        <button className="btn" type="button" onClick={() => setIsTarifModalOpen(false)}>
                          Fermer
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

export default App
