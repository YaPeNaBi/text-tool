import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { keepDocument, restoreDocument } from './app/state/store.ts';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('#root missing');

// Last time's drawing first, then start keeping this time's — in that order,
// so the restore is not itself kept back as a change (B-FILE-06).
restoreDocument();
keepDocument();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
