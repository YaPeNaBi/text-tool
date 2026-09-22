import { CanvasView } from './app/canvas/CanvasView.tsx';
import { StatusBar } from './app/components/StatusBar.tsx';
import { Ribbon } from './app/components/Ribbon.tsx';
import { Toolbar } from './app/components/Toolbar.tsx';

export function App(): React.JSX.Element {
  return (
    <div className="app">
      <Toolbar />
      <Ribbon />
      <CanvasView />
      <StatusBar />
    </div>
  );
}
