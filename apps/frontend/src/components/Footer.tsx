export default function Footer() {
  return (
    <footer className="bg-gray-800 text-white mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center">
          <div className="mb-4 md:mb-0">
            <p className="text-sm">
              Made by <span className="font-semibold">Баталов Михаил</span>
            </p>
          </div>
          <div>
            <a
              href="https://twitch.tv/LOTAS_bro"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm hover:text-purple-400 transition-colors"
            >
              twitch.tv/LOTAS_bro
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

