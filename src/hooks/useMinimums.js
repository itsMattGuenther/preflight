import { useCallback, useMemo, useState } from 'react';
import { DEFAULT_MINIMUMS } from '../lib/aviation/minimums';
import { readJson, writeJson } from '../lib/storage';

// Personal minimums are stored only in this browser. Nothing about the pilot
// is sent to a server.
const KEY = 'preflight:minimums:v1';

export function useMinimums() {
  const [stored, setStored] = useState(() => readJson(KEY, null));
  const minimums = useMemo(() => ({ ...DEFAULT_MINIMUMS, ...(stored || {}) }), [stored]);

  const save = useCallback((values) => {
    writeJson(KEY, values);
    setStored(values);
  }, []);

  const reset = useCallback(() => {
    writeJson(KEY, null);
    setStored(null);
  }, []);

  return { minimums, isExample: !stored, save, reset };
}
