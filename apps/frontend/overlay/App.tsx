import { Routes, Route } from 'react-router-dom';

import OverlayView from './OverlayView';
import CreditsOverlayView from './CreditsOverlayView';

function App() {
  return (
    <Routes>
      <Route path="/t/:token" element={<OverlayView />} />
      <Route path="/:channelSlug" element={<OverlayView />} />
      <Route path="/credits/t/:token" element={<CreditsOverlayView />} />
      <Route path="/credits/:channelSlug" element={<CreditsOverlayView />} />
    </Routes>
  );
}

export default App;


