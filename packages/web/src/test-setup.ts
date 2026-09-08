import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { resetApp } from './testing.ts';

// Testing Library's automatic cleanup only registers when Vitest globals are
// enabled; this config keeps explicit imports, so unmount by hand.
afterEach(cleanup);

// fake-indexeddb and the zustand store are both process-wide singletons, so
// without this every test file has to remember its own reset — and the one
// that forgot (App.test.tsx) leaked a half-finished library load into whatever
// test came next.
beforeEach(resetApp);
