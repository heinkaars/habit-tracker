import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import {
  dismissCoachNote,
  fetchCoachNote,
  fetchReflection,
  type CoachNote,
  type Reflection,
} from '@/lib/coach';
import { dayKey } from '@/lib/habits';

/**
 * Today's coaching note.
 *
 * Fetched once per mount and never awaited by anything the user is waiting on —
 * the card appears when it arrives. Generation happens server-side at most once
 * per day, so remounting the screen costs a cached read rather than a model
 * call.
 */
export function useCoachNote() {
  const { user } = useAuth();
  const [note, setNote] = useState<CoachNote | null>(null);
  const [loading, setLoading] = useState(false);
  const today = dayKey();

  useEffect(() => {
    if (!user) {
      setNote(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchCoachNote(today)
      .then((next) => {
        if (!cancelled) setNote(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, today]);

  const dismiss = useCallback(() => {
    if (!note) return;

    // Hide it immediately; the write catches up on its own. Waiting on the
    // network before the card disappears would make dismissal feel broken.
    setNote(null);
    dismissCoachNote(note.day).catch(() => {});
  }, [note]);

  return { note: note?.dismissedAt ? null : note, loading, dismiss };
}

/** The most recent completed week's reflection. */
export function useReflection(period: 'week' | 'month' = 'week') {
  const { user } = useAuth();
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [loading, setLoading] = useState(false);
  const today = dayKey();

  useEffect(() => {
    if (!user) {
      setReflection(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchReflection(period, today)
      .then((next) => {
        if (!cancelled) setReflection(next);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user, period, today]);

  return { reflection, loading };
}
