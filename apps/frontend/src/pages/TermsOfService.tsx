import { Link } from 'react-router-dom';
import UserMenu from '../components/UserMenu';
import { useAppSelector } from '../store/hooks';
import Footer from '../components/Footer';

export default function TermsOfService() {
  const { user } = useAppSelector((state) => state.auth);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link to="/" className="text-xl font-bold">
              Mem Alerts
            </Link>
            {user && <UserMenu />}
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow">
        <div className="bg-white rounded-lg shadow p-8">
          <h1 className="text-3xl font-bold mb-6">Terms of Service</h1>
          
          <div className="prose max-w-none">
            <p className="text-gray-600 mb-4">Last updated: {new Date().toLocaleDateString()}</p>
            
            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">1. Acceptance of Terms</h2>
              <p className="text-gray-700">
                By accessing and using Mem Alerts, you accept and agree to be bound by the terms and provision of this agreement.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">2. Use License</h2>
              <p className="text-gray-700 mb-2">
                Permission is granted to temporarily use Mem Alerts for personal, non-commercial transitory viewing only.
              </p>
              <p className="text-gray-700">
                This is the grant of a license, not a transfer of title, and under this license you may not:
              </p>
              <ul className="list-disc list-inside text-gray-700 ml-4">
                <li>Modify or copy the materials</li>
                <li>Use the materials for any commercial purpose</li>
                <li>Attempt to decompile or reverse engineer any software</li>
                <li>Remove any copyright or other proprietary notations</li>
              </ul>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">3. User Content</h2>
              <p className="text-gray-700">
                You are responsible for any content you submit to Mem Alerts. You agree not to submit content that is illegal, 
                offensive, or violates any third-party rights.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">4. Disclaimer</h2>
              <p className="text-gray-700">
                The materials on Mem Alerts are provided on an 'as is' basis. Mem Alerts makes no warranties, expressed or implied, 
                and hereby disclaims and negates all other warranties including without limitation, implied warranties or conditions 
                of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">5. Limitations</h2>
              <p className="text-gray-700">
                In no event shall Mem Alerts or its suppliers be liable for any damages (including, without limitation, damages for loss 
                of data or profit, or due to business interruption) arising out of the use or inability to use the materials on Mem Alerts.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">6. Revisions</h2>
              <p className="text-gray-700">
                Mem Alerts may revise these terms of service at any time without notice. By using this website you are agreeing to be 
                bound by the then current version of these terms of service.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

