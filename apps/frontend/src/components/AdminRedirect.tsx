import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function AdminRedirect() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab) {
      navigate(`/settings?tab=${tab}`, { replace: true });
    } else {
      // Default to submissions tab
      navigate('/settings?tab=submissions', { replace: true });
    }
  }, [navigate, searchParams]);

  return null;
}

