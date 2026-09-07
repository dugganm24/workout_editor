import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library's automatic cleanup only registers when Vitest globals are
// enabled; this config keeps explicit imports, so unmount by hand.
afterEach(cleanup);
