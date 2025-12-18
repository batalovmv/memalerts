import { Link } from 'react-router-dom';
import UserMenu from '../components/UserMenu';
import { useAppSelector } from '../store/hooks';
import Footer from '../components/Footer';

export default function PrivacyPolicy() {
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
          <h1 className="text-3xl font-bold mb-6">Privacy Policy</h1>
          
          <div className="prose max-w-none">
            <p className="text-gray-600 mb-4">Last updated: {new Date().toLocaleDateString()}</p>
            
            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">1. Information We Collect</h2>
              <p className="text-gray-700 mb-2">
                We collect information that you provide directly to us, including:
              </p>
              <ul className="list-disc list-inside text-gray-700 ml-4">
                <li>Twitch account information (display name, user ID)</li>
                <li>Content you submit (memes, titles, tags, notes)</li>
                <li>Usage data and analytics</li>
              </ul>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">2. How We Use Your Information</h2>
              <p className="text-gray-700 mb-2">We use the information we collect to:</p>
              <ul className="list-disc list-inside text-gray-700 ml-4">
                <li>Provide, maintain, and improve our services</li>
                <li>Process and manage meme submissions</li>
                <li>Manage user balances and transactions</li>
                <li>Send you technical notices and support messages</li>
              </ul>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">3. Information Sharing</h2>
              <p className="text-gray-700">
                We do not sell, trade, or otherwise transfer your personal information to third parties without your consent, 
                except as described in this policy. We may share information with service providers who assist us in operating 
                our website and conducting our business.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">4. Data Security</h2>
              <p className="text-gray-700">
                We implement appropriate security measures to protect your personal information. However, no method of transmission 
                over the Internet or electronic storage is 100% secure, and we cannot guarantee absolute security.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">5. Cookies</h2>
              <p className="text-gray-700">
                We use cookies to maintain your session and authenticate you. You can control cookies through your browser settings, 
                but this may affect your ability to use certain features of our service.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">6. Your Rights</h2>
              <p className="text-gray-700">
                You have the right to access, update, or delete your personal information. You can also opt out of certain data 
                collection practices. To exercise these rights, please contact us.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">7. Changes to This Policy</h2>
              <p className="text-gray-700">
                We may update this privacy policy from time to time. We will notify you of any changes by posting the new policy 
                on this page and updating the &quot;Last updated&quot; date.
              </p>
            </section>

            <section className="mb-6">
              <h2 className="text-2xl font-semibold mb-3">8. Contact Us</h2>
              <p className="text-gray-700">
                If you have any questions about this Privacy Policy, please contact us through our website.
              </p>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

