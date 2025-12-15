import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAppDispatch } from './store/hooks';
import { fetchUser } from './store/slices/authSlice';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import Submit from './pages/Submit';
import Admin from './pages/Admin';

function App() {
  const dispatch = useAppDispatch();

  useEffect(() => {
    dispatch(fetchUser());
  }, [dispatch]);

  return (
    <>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </>
  );
}

export default App;


