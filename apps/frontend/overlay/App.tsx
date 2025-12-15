import { Routes, Route, useParams } from 'react-router-dom';
import OverlayView from './OverlayView';

function App() {
  return (
    <Routes>
      <Route path="/overlay/:channelSlug" element={<OverlayView />} />
    </Routes>
  );
}

export default App;


