import React from 'react';
import { Globe, ArrowUpRight, MapPin, Code2 } from 'lucide-react';
import creatorPhoto from '../assets/creator-photo.jpg';

const LinkedInIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M19 3A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3H19M18.5 18.5V13.2A3.26 3.26 0 0 0 15.24 9.94C14.39 9.94 13.4 10.46 12.92 11.24V10.13H10.13V18.5H12.92V13.57C12.92 12.8 13.54 12.17 14.31 12.17A1.4 1.4 0 0 1 15.71 13.57V18.5H18.5M6.88 8.56A1.68 1.68 0 0 0 8.56 6.88C8.56 5.95 7.81 5.19 6.88 5.19A1.69 1.69 0 0 0 5.19 6.88C5.19 7.81 5.95 8.56 6.88 8.56M8.27 18.5V10.13H5.5V18.5H8.27Z" />
  </svg>
);

const GitHubIcon: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 2A10 10 0 0 0 2 12C2 16.42 4.87 20.17 8.84 21.5C9.34 21.58 9.5 21.27 9.5 21C9.5 20.77 9.5 20.14 9.5 19.31C6.73 19.91 6.14 17.97 6.14 17.97C5.68 16.81 5.03 16.5 5.03 16.5C4.12 15.88 5.1 15.9 5.1 15.9C6.1 15.97 6.63 16.93 6.63 16.93C7.5 18.45 8.97 18 9.54 17.76C9.63 17.11 9.89 16.67 10.17 16.42C7.95 16.17 5.62 15.31 5.62 11.5C5.62 10.39 6 9.5 6.65 8.79C6.55 8.54 6.2 7.5 6.75 6.15C6.75 6.15 7.59 5.88 9.5 7.17C10.29 6.95 11.15 6.84 12 6.84C12.85 6.84 13.71 6.95 14.5 7.17C16.41 5.88 17.25 6.15 17.25 6.15C17.8 7.5 17.45 8.54 17.35 8.79C18 9.5 18.38 10.39 18.38 11.5C18.38 15.32 16.04 16.16 13.81 16.41C14.17 16.72 14.5 17.33 14.5 18.26C14.5 19.6 14.5 20.68 14.5 21C14.5 21.27 14.66 21.59 15.17 21.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2Z" />
  </svg>
);

const INTERESTS = ['Web Development', 'Python', 'C++', 'Software Engineering'];

const SOCIAL_LINKS = [
  {
    name: 'Portfolio',
    handle: 'mazharul.bro.bd',
    url: 'https://mazharul.bro.bd',
    icon: Globe,
    accent: 'text-emerald-600 dark:text-emerald-300 bg-emerald-500/15 border-emerald-400/25',
  },
  {
    name: 'LinkedIn',
    handle: 'in/rafimazharul',
    url: 'https://www.linkedin.com/in/rafimazharul/',
    icon: LinkedInIcon,
    accent: 'text-sky-600 dark:text-sky-300 bg-sky-500/15 border-sky-400/25',
  },
  {
    name: 'GitHub',
    handle: '@rafimazharul',
    url: 'https://github.com/rafimazharul',
    icon: GitHubIcon,
    accent: 'text-teal-600 dark:text-teal-300 bg-teal-500/15 border-teal-400/25',
  },
];

export const AboutCreatorView: React.FC = () => {
  const handleOpenLink = (url: string) => {
    void window.smartDM.openExternal(url);
  };

  return (
    <div className="max-w-3xl mx-auto py-2 pb-8 space-y-5">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">
          About the Creator
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-300/75 mt-0.5">
          Meet the developer behind Smart Video Downloader.
        </p>
      </div>

      {/* Hero Profile Glass Card */}
      <section className="glass-tile rounded-[28px] p-6 sm:p-8 relative overflow-hidden">
        {/* Subtle ambient emerald highlight */}
        <div className="pointer-events-none absolute -top-20 -right-20 w-56 h-56 rounded-full bg-emerald-400/15 blur-3xl" />

        <div className="relative flex flex-col sm:flex-row items-center sm:items-start gap-6">
          {/* Profile Photo */}
          <div className="shrink-0 group">
            <div className="p-1.5 rounded-[28px] bg-gradient-to-br from-[#10B981] via-[#14B8A6] to-[#2DD4BF] shadow-xl shadow-emerald-500/20 transition-transform duration-300 group-hover:scale-[1.03]">
              <img
                src={creatorPhoto}
                alt="Mazharul Islam Rafi"
                className="w-28 h-28 sm:w-32 sm:h-32 rounded-[22px] object-cover object-top block bg-slate-900"
              />
            </div>
          </div>

          {/* Creator Name & Intro */}
          <div className="flex-1 text-center sm:text-left space-y-3">
            <div>
              <h1 className="text-2xl sm:text-[26px] font-bold tracking-tight text-slate-900 dark:text-white">
                Mazharul Islam Rafi
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full glass-well font-medium">
                  <Code2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-300" />
                  CSE Student & Aspiring Software Engineer
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full glass-well">
                  <MapPin className="w-3.5 h-3.5 text-teal-600 dark:text-teal-300" />
                  Bangladesh
                </span>
              </div>
            </div>

            <div className="space-y-2.5 text-[13.5px] leading-relaxed text-slate-700 dark:text-slate-200/90">
              <p>
                Hi, I&apos;m Rafi, a CSE student and aspiring Software Engineer from Bangladesh. I
                enjoy building software, exploring new technologies, and solving problems through
                code.
              </p>
              <p>
                My interests include Web Development, Python, C++, and Software Engineering.
              </p>
            </div>

            {/* Minimal Interest Pills */}
            <div className="pt-1 flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
              {INTERESTS.map((topic) => (
                <span
                  key={topic}
                  className="px-3 py-1 rounded-full text-[11.5px] font-medium glass-pill text-emerald-700 dark:text-emerald-200"
                >
                  {topic}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Connect with Me */}
      <section className="glass-tile rounded-[24px] p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Connect with Me
          </h3>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Opens in default browser
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SOCIAL_LINKS.map((link) => {
            const Icon = link.icon;
            return (
              <button
                key={link.name}
                type="button"
                onClick={() => handleOpenLink(link.url)}
                className="group glass-well hover:border-emerald-400/45 rounded-[18px] p-4 text-left flex items-center justify-between gap-3 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`w-10 h-10 rounded-[14px] border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-105 ${link.accent}`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {link.name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {link.handle}
                    </div>
                  </div>
                </div>
                <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-500 dark:group-hover:text-emerald-300 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 shrink-0" />
              </button>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center pt-2">
        <p className="text-xs text-slate-500 dark:text-slate-400/80">
          © 2026 Mazharul Islam Rafi. All rights reserved.
        </p>
      </footer>
    </div>
  );
};
