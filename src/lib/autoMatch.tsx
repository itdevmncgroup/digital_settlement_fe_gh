'use client';

import { createContext, useContext, useRef, useState, ReactNode } from 'react';
import { ApiError, uploadFile } from './api';

export interface ScannedTransactionRow {
  id: string;
  transactionDate: string | null;
  rawDescription: string;
  amount: string;
  status: 'UNMATCHED' | 'AUTO_MATCHED' | 'REVIEW_REQUIRED' | 'MANUAL_MATCHED';
  matchedExpense: { expenseNo: string; sales?: { name: string } } | null;
}

export interface ScannedBatch {
  id: string;
  fileName: string;
  transactions: ScannedTransactionRow[];
  alreadyScanned?: boolean;
}

export interface AutoMatchProgress {
  current: number;
  total: number;
  fileName: string;
}

interface AutoMatchContextValue {
  running: boolean;
  progress: AutoMatchProgress | null;
  message: string;
  error: string;
  batches: ScannedBatch[];
  /** Bumps once per file as its match result lands - subscribe to it to refresh a table live. */
  version: number;
  start: (files: File[], forceRescan: boolean) => void;
}

const AutoMatchContext = createContext<AutoMatchContextValue | undefined>(undefined);

export function AutoMatchProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<AutoMatchProgress | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [batches, setBatches] = useState<ScannedBatch[]>([]);
  const [version, setVersion] = useState(0);
  // Guards against a second start() firing while a run is already in flight -
  // state alone isn't enough since the check-and-set has to happen synchronously.
  const runningRef = useRef(false);

  // Runs detached from whichever component called start() - lives on the
  // provider mounted at the root layout, so it keeps going across in-app page
  // navigation (the provider tree is never unmounted, only its children swap).
  const start = (files: File[], forceRescan: boolean) => {
    if (runningRef.current || files.length === 0) return;
    runningRef.current = true;
    setRunning(true);
    setMessage('');
    setError('');
    setBatches([]);
    setProgress({ current: 0, total: files.length, fileName: files[0].name });

    (async () => {
      const results: ScannedBatch[] = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          setProgress({ current: i, total: files.length, fileName: file.name });
          const batch = (await uploadFile('/bank-settlements', file, forceRescan ? '?force=true' : '')) as ScannedBatch;
          results.push(batch);
          setBatches([...results]);
          setVersion((v) => v + 1);
        }
        const reused = results.filter((b) => b.alreadyScanned).length;
        setMessage(
          reused > 0
            ? `Matching finished for ${files.length} file(s) - ${reused} sudah pernah discan sebelumnya (hasil lama ditampilkan).`
            : `Matching finished for ${files.length} file(s).`,
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Auto match failed');
      } finally {
        setProgress(null);
        setRunning(false);
        runningRef.current = false;
      }
    })();
  };

  return (
    <AutoMatchContext.Provider value={{ running, progress, message, error, batches, version, start }}>
      {children}
    </AutoMatchContext.Provider>
  );
}

export function useAutoMatch(): AutoMatchContextValue {
  const ctx = useContext(AutoMatchContext);
  if (!ctx) throw new Error('useAutoMatch must be used within AutoMatchProvider');
  return ctx;
}
