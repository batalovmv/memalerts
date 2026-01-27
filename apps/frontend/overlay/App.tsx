import { Routes, Route } from 'react-router-dom';

import OverlayView from './OverlayView';

function App() {
  return (
    <Routes>
      <Route path="/t/:token" element={<OverlayView />} />
      <Route path="/:channelSlug" element={<OverlayView />} />
    </Routes>
  );
}

export default App;

