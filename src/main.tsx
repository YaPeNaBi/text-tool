import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { followLanguage, followTheme, keepDocument, openLink, restoreDocument } from './app/state/store.ts';
import './styles.css';

const root = document.getElementById('root');
if (root === null) throw new Error('#root missing');

// The theme on <html>, where the stylesheet looks for it (B-UI-18). Usually
// already there: index.html set it from the same kept value before the first
// paint. From here the store owns it, and every change is kept.
followTheme((theme) => {
  document.documentElement.dataset['theme'] = theme;
});

// The interface's language (B-UI-19): kept, else the browser's, else English —
// and on <html lang>, so assistive technology reads the page in it. Its words
// are a separate file for every language but English, and the first frame
// waits for them below.
const language = followLanguage(navigator.languages, (lang) => {
  document.documentElement.lang = lang;
});

// Last time's drawing first; then a link in the address, which goes on top of
// it; and only then start keeping, so the restore is not kept back as a change
// (B-FILE-06, B-FILE-08). The first frame waits for the link, a few
// milliseconds of inflate, so the page never shows one drawing and then swaps
// in another.
restoreDocument();
void Promise.allSettled([openLink(), language]).finally(() => {
  keepDocument();
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

// A link pasted into this tab's address bar changes only the fragment, and a
// fragment change is not a load: nothing above runs again, so this has to.
window.addEventListener('hashchange', () => void openLink());
