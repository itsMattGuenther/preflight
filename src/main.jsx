import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Each hook sets its own staleTime/refetchInterval. Returning to the tab
      // refetches anything stale, so a briefing left open overnight is fresh
      // when the pilot looks at it again.
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
