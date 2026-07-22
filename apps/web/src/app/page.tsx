'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { EarningsCalculator } from '@/components/earnings-calculator';
import { useAuth } from '@/lib/auth-context';
import { getDashboardPath } from '@/lib/auth-routing';

const SPONSORS = [
  { name: 'Railway', desc: 'Deploy from your terminal in minutes', color: '#13111a' },
  { name: 'Neon', desc: 'Serverless Postgres for AI-native apps', color: '#00a86b' },
  { name: 'Sentry', desc: 'Find production bugs before users do', color: '#362d59' },
  { name: 'Clerk', desc: 'Authentication built for modern apps', color: '#6c47ff' },
] as const;

export default function HomePage() {
  const { isAuthenticated, user } = useAuth();
  const dashboardPath = user ? getDashboardPath(user.role) : '/developer';
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(media.matches);

    updatePreference();
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

  /* ── Terminal Simulator Animation State ── */
  const [termStep, setTermStep] = useState(0);
  const [sponsorIndex, setSponsorIndex] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion) {
      setTermStep(4);
      return;
    }

    const timer = setInterval(() => {
      setTermStep((prev) => {
        if (prev >= 4) {
          return 0;
        }
        const next = prev + 1;
        if (next === 1) {
          setSponsorIndex((idx) => (idx + 1) % SPONSORS.length);
        }
        return next;
      });
    }, 2500);
    return () => clearInterval(timer);
  }, [prefersReducedMotion]);

  const activeSponsor = SPONSORS[sponsorIndex];

  /* ── Verification Pipeline State ── */
  const [verifyStep, setVerifyStep] = useState(0);
  const [verifiedCount, setVerifiedCount] = useState(1284);
  const [verifyStarted, setVerifyStarted] = useState(false);
  const verifyRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (prefersReducedMotion) {
      setVerifyStarted(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVerifyStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    if (verifyRef.current) {
      observer.observe(verifyRef.current);
    }
    return () => observer.disconnect();
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (!verifyStarted) return;
    if (prefersReducedMotion) {
      setVerifyStep(5);
      setVerifiedCount(1285);
      return;
    }

    let currentStep = 0;
    const interval = setInterval(() => {
      currentStep++;
      setVerifyStep(currentStep);
      if (currentStep >= 5) {
        setVerifiedCount(1285);
        clearInterval(interval);
      }
    }, 500);
    return () => clearInterval(interval);
  }, [prefersReducedMotion, verifyStarted]);

  return (
    <div className="min-h-screen bg-white text-[#0a0a0a] antialiased selection:bg-[#0a0a0a] selection:text-white">
      {/* ── Navigation Header ── */}
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          background: 'rgba(255,255,255,.82)',
          backdropFilter: 'saturate(180%) blur(14px)',
          borderBottom: '1px solid #ececec',
        }}
      >
        <div
          style={{
            maxWidth: '1180px',
            margin: '0 auto',
            padding: '0 32px',
            height: '64px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <svg width="17" height="17" viewBox="0 0 16 16" aria-hidden="true">
              <rect x="0" y="1.5" width="16" height="2.4" rx="0.4" fill="#0a0a0a" />
              <rect x="0" y="6.8" width="16" height="2.4" rx="0.4" fill="#0a0a0a" />
              <rect x="0" y="12.1" width="11" height="2.4" rx="0.4" fill="var(--accent,#16a34a)" />
            </svg>
            <span style={{ fontSize: '16.5px', fontWeight: 600, letterSpacing: '-.01em' }}>
              WaitLayer
            </span>
          </Link>
          <nav
            className="wl-nav-links"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '34px',
              fontSize: '14.5px',
              color: '#444',
            }}
          >
            <a href="#developers" className="wl-link-u" style={{ opacity: 0.85 }}>
              Developers
            </a>
            <a href="#sponsors" className="wl-link-u" style={{ opacity: 0.85 }}>
              Sponsors
            </a>
            <Link href="/pricing" className="wl-link-u" style={{ opacity: 0.85 }}>
              Pricing
            </Link>
            <a href="#trust" className="wl-link-u" style={{ opacity: 0.85 }}>
              Trust
            </a>
            <Link href="/comparison" className="wl-link-u" style={{ opacity: 0.85 }}>
              Roadmap
            </Link>
          </nav>
          <Link
            href={isAuthenticated ? dashboardPath : '/auth/signup?role=developer'}
            className="wlh-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: '38px',
              padding: '0 18px',
              background: '#0a0a0a',
              color: '#fff',
              fontSize: '14px',
              fontWeight: 500,
              borderRadius: '7px',
            }}
          >
            {isAuthenticated ? 'Dashboard' : 'Join beta'}
          </Link>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        {/* ── Section 1: Hero ── */}
        <section style={{ padding: '76px 0 88px', borderBottom: '1px solid #ececec' }}>
          <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0 32px' }}>
            <div
              className="wl-hero-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0,1.04fr) minmax(0,.96fr)',
                gap: '68px',
                alignItems: 'center',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className="wlh-in"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '9px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '11.5px',
                    letterSpacing: '.12em',
                    textTransform: 'uppercase',
                    color: '#666',
                    border: '1px solid #e2e2e2',
                    borderRadius: '100px',
                    padding: '6px 13px',
                    marginBottom: '26px',
                  }}
                >
                  <span
                    className="wl-dot"
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: 'var(--accent,#16a34a)',
                      display: 'inline-block',
                    }}
                  ></span>
                  Private beta · rewards not yet enabled
                </div>
                <h1
                  className="wlh-in"
                  style={{
                    fontFamily: "'Instrument Serif', Georgia, serif",
                    fontWeight: 400,
                    fontSize: 'clamp(40px, 5.2vw, 64px)',
                    lineHeight: 1.02,
                    letterSpacing: '-.02em',
                    margin: '0 0 24px',
                    color: '#0a0a0a',
                    textWrap: 'balance',
                    animationDelay: '70ms',
                  }}
                >
                  Help validate AI wait states without giving up your privacy.
                </h1>
                <p
                  className="wlh-in"
                  style={{
                    maxWidth: '480px',
                    fontSize: '18.5px',
                    lineHeight: 1.6,
                    color: '#555',
                    margin: '0 0 30px',
                    animationDelay: '140ms',
                  }}
                >
                  Your coding agent works; you wait. WaitLayer is validating a private,
                  independently attestable wait signal before it opens sponsor-funded rewards.
                </p>
                <div
                  className="wlh-in"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '12px',
                    alignItems: 'center',
                    marginBottom: '26px',
                    animationDelay: '210ms',
                  }}
                >
                  <Link
                    href={isAuthenticated ? dashboardPath : '/auth/signup?role=developer'}
                    className="wlh-btn"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      height: '50px',
                      padding: '0 26px',
                      background: '#0a0a0a',
                      color: '#fff',
                      border: 'none',
                      fontSize: '15.5px',
                      fontWeight: 600,
                      borderRadius: '9px',
                    }}
                  >
                    {isAuthenticated ? 'Go to Dashboard' : 'Join the founding beta'}
                  </Link>
                  <a
                    className="wl-link-u"
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '13px',
                      color: '#666',
                    }}
                    href="#trust"
                  >
                    What we never collect →
                  </a>
                </div>
                <div
                  className="wlh-in"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px 16px',
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '12px',
                    color: '#6b6b6b',
                    animationDelay: '280ms',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '16px' }}>
                    <span>Designed for Claude Code, Cursor, and your terminal</span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ color: '#6b6b6b' }}>/</span>
                    <span>No code · prompts · output</span>
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ color: '#6b6b6b' }}>/</span>
                    <span>60% share after verified settlement launches</span>
                  </span>
                </div>
              </div>

              {/* Terminal Simulator */}
              <div className="wlh-in" style={{ minWidth: 0, animationDelay: '180ms' }}>
                <div
                  aria-hidden="true"
                  style={{
                    background: '#0c0c0c',
                    border: '1px solid #1c1c1c',
                    borderRadius: '14px',
                    boxShadow: 'var(--term-shadow)',
                    fontFamily: "'IBM Plex Mono', monospace",
                    overflow: 'hidden',
                    userSelect: 'none',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      padding: '12px 16px',
                      borderBottom: '1px solid #181818',
                    }}
                  >
                    <span
                      style={{
                        width: '11px',
                        height: '11px',
                        borderRadius: '50%',
                        background: '#ff5f56',
                        opacity: 0.9,
                      }}
                    ></span>
                    <span
                      style={{
                        width: '11px',
                        height: '11px',
                        borderRadius: '50%',
                        background: '#ffbd2e',
                        opacity: 0.9,
                      }}
                    ></span>
                    <span
                      style={{
                        width: '11px',
                        height: '11px',
                        borderRadius: '50%',
                        background: '#27c93f',
                        opacity: 0.9,
                      }}
                    ></span>
                    <span style={{ marginLeft: '8px', color: '#a8a8a8', fontSize: '11.5px' }}>
                      illustrative Claude session — waitlayer
                    </span>
                  </div>
                  <div
                    style={{
                      padding: '20px 22px 18px',
                      fontSize: 'clamp(11px, 3vw, 13px)',
                      lineHeight: 1.5,
                      color: '#cfcfcf',
                      minHeight: '250px',
                    }}
                  >
                    <div style={{ transition: 'opacity .4s ease' }}>
                      <span style={{ color: '#a8a8a8' }}>&gt;</span> refactor the auth middleware to
                      use the session helper
                      <span
                        className="wl-vcaret"
                        style={{
                          display: 'inline-block',
                          width: '8px',
                          height: '14px',
                          background: 'currentColor',
                          verticalAlign: 'middle',
                        }}
                      ></span>
                    </div>

                    <div
                      style={{
                        marginTop: '12px',
                        height: '20px',
                        display: 'flex',
                        flexWrap: 'nowrap',
                        alignItems: 'center',
                        gap: '8px',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        opacity: termStep >= 1 ? 1 : 0,
                        transition: 'opacity .45s ease',
                      }}
                    >
                      <span style={{ color: 'var(--accent,#16a34a)', flex: 'none' }}>✓</span>
                      <span style={{ color: '#b5b5b5' }}>done · 8.2s</span>
                    </div>

                    <div
                      style={{
                        marginTop: '14px',
                        border: '1px solid #1e1e1e',
                        borderRadius: '8px',
                        background: '#0f0f0f',
                        padding: '11px 13px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        opacity: termStep >= 2 ? 1 : 0,
                        transform: termStep >= 2 ? 'none' : 'translateY(6px)',
                        transition: 'opacity .5s ease, transform .5s cubic-bezier(.2,.7,.3,1)',
                      }}
                    >
                      <span
                        style={{
                          width: '15px',
                          height: '15px',
                          borderRadius: '4px',
                          background: activeSponsor.color,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flex: 'none',
                        }}
                      >
                        <svg width="8" height="8" viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M4 18 L12 5 L20 18 Z"
                            fill="none"
                            stroke="#fff"
                            strokeWidth="2.4"
                          ></path>
                        </svg>
                      </span>
                      <span
                        style={{
                          color: '#a8a8a8',
                          flex: 'none',
                          fontSize: '11px',
                          letterSpacing: '.06em',
                          textTransform: 'uppercase',
                        }}
                      >
                        Example sponsor line
                      </span>
                      <span style={{ color: '#e8e8e8', flex: 'none' }}>{activeSponsor.name}</span>
                      <span style={{ color: '#3a3a3a' }}>·</span>
                      <span
                        style={{
                          color: '#b5b5b5',
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {activeSponsor.desc}
                      </span>
                    </div>

                    <div
                      style={{
                        marginTop: '14px',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px 14px',
                        alignItems: 'center',
                        minHeight: '18px',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: '#bdbdbd',
                          fontSize: '12px',
                          opacity: termStep >= 3 ? 1 : 0,
                          transition: 'opacity .3s ease',
                        }}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--accent,#16a34a)"
                          strokeWidth="2.6"
                          style={{ flex: 'none' }}
                        >
                          <path d="M5 12.5l4 4 10-10"></path>
                        </svg>
                        signature valid
                      </span>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: '#bdbdbd',
                          fontSize: '12px',
                          opacity: termStep >= 3 ? 1 : 0,
                          transition: 'opacity .3s ease .25s',
                        }}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--accent,#16a34a)"
                          strokeWidth="2.6"
                          style={{ flex: 'none' }}
                        >
                          <path d="M5 12.5l4 4 10-10"></path>
                        </svg>
                        not a duplicate
                      </span>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          color: '#bdbdbd',
                          fontSize: '12px',
                          opacity: termStep >= 3 ? 1 : 0,
                          transition: 'opacity .3s ease .5s',
                        }}
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="var(--accent,#16a34a)"
                          strokeWidth="2.6"
                          style={{ flex: 'none' }}
                        >
                          <path d="M5 12.5l4 4 10-10"></path>
                        </svg>
                        fraud-cleared
                      </span>
                    </div>

                    <div
                      style={{
                        marginTop: '16px',
                        paddingTop: '14px',
                        borderTop: '1px solid #181818',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        opacity: termStep >= 4 ? 1 : 0,
                        transform: termStep >= 4 ? 'none' : 'translateY(4px)',
                        transition: 'opacity .5s ease, transform .5s ease',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          color: 'var(--accent,#16a34a)',
                          fontSize: '14px',
                        }}
                      >
                        <span
                          style={{
                            width: '6px',
                            height: '6px',
                            borderRadius: '50%',
                            background: 'var(--accent,#16a34a)',
                          }}
                          className="wl-dot"
                        ></span>
                        beta telemetry validation · rewards disabled
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 2: Three Cards ── */}
        <section
          style={{ padding: '60px 0', background: '#fafafa', borderBottom: '1px solid #ececec' }}
        >
          <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0 32px' }}>
            <div
              className="wl-cards"
              style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0 }}
            >
              <div style={{ padding: '6px 28px' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '14px',
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '11px',
                      color: '#15803d',
                    }}
                  >
                    01
                  </span>
                  <span style={{ flex: 1, height: '1px', background: '#e6e6e6' }}></span>
                </div>
                <div
                  style={{
                    fontSize: '17px',
                    fontWeight: 600,
                    color: '#0a0a0a',
                    marginBottom: '7px',
                  }}
                >
                  Your agent works
                </div>
                <p style={{ fontSize: '14.5px', lineHeight: 1.55, color: '#666', margin: 0 }}>
                  You ask Claude Code to build. Then you wait — many times a day.
                </p>
              </div>
              <div style={{ padding: '6px 28px', borderLeft: '1px solid #e6e6e6' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '14px',
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '11px',
                      color: '#15803d',
                    }}
                  >
                    02
                  </span>
                  <span style={{ flex: 1, height: '1px', background: '#e6e6e6' }}></span>
                </div>
                <div
                  style={{
                    fontSize: '17px',
                    fontWeight: 600,
                    color: '#0a0a0a',
                    marginBottom: '7px',
                  }}
                >
                  One labeled line
                </div>
                <p style={{ fontSize: '14.5px', lineHeight: 1.55, color: '#666', margin: 0 }}>
                  A single, clearly-marked sponsor line appears in the wait. Nothing else changes.
                </p>
              </div>
              <div style={{ padding: '6px 28px', borderLeft: '1px solid #e6e6e6' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '14px',
                  }}
                >
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '11px',
                      color: '#15803d',
                    }}
                  >
                    03
                  </span>
                  <span style={{ flex: 1, height: '1px', background: '#e6e6e6' }}></span>
                </div>
                <div
                  style={{
                    fontSize: '17px',
                    fontWeight: 600,
                    color: '#0a0a0a',
                    marginBottom: '7px',
                  }}
                >
                  Rewards launch after verification
                </div>
                <p style={{ fontSize: '14.5px', lineHeight: 1.55, color: '#666', margin: 0 }}>
                  Beta signals are reviewed first. Sponsor-funded rewards remain disabled until the
                  production attestation path is independently verified.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 3: Verification ── */}
        <section
          ref={verifyRef}
          className="wl-sec"
          style={{ padding: '100px 0', borderBottom: '1px solid #ececec' }}
        >
          <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0 32px' }}>
            <div
              className="wl-2col wlh-in"
              style={{
                display: 'grid',
                gridTemplateColumns: '.82fr 1.18fr',
                gap: '56px',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '11.5px',
                    letterSpacing: '.14em',
                    textTransform: 'uppercase',
                    color: '#6b6b6b',
                  }}
                >
                  Verification
                </div>
                <h2
                  style={{
                    fontFamily: "'Instrument Serif', serif",
                    fontWeight: 400,
                    fontSize: 'clamp(32px, 4.4vw, 52px)',
                    lineHeight: 1.04,
                    letterSpacing: '-.014em',
                    margin: '14px 0 0',
                    color: '#0a0a0a',
                    textWrap: 'balance',
                  }}
                >
                  Verified, or it doesn't count.
                </h2>
                <p
                  style={{
                    fontSize: '17px',
                    lineHeight: 1.62,
                    color: '#555',
                    margin: '20px 0 0',
                    maxWidth: '400px',
                  }}
                >
                  Every impression clears the same five checks before it can ever earn — measured on
                  your machine, settled to a local ledger.
                </p>
              </div>
              <div>
                <div
                  style={{
                    border: '1px solid #e6e6e6',
                    borderRadius: '16px',
                    background: '#fff',
                    padding: '26px 30px 30px',
                    boxShadow: '0 18px 40px -32px rgba(0,0,0,.25)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      marginBottom: '28px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '9px',
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '11px',
                        letterSpacing: '.1em',
                        textTransform: 'uppercase',
                        color: '#6b6b6b',
                      }}
                    >
                      <span
                        className={verifyStep >= 5 ? '' : 'wl-dot'}
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          background: '#16a34a',
                        }}
                      ></span>
                      {verifyStep >= 5
                        ? 'Impression verified'
                        : `Verifying impression${'.'.repeat(verifyStep % 4)}`}
                    </span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '12px',
                        color: '#6b6b6b',
                      }}
                    >
                      ledger ·{' '}
                      <span
                        style={{
                          color: verifyStep === 5 ? '#16a34a' : '#0a0a0a',
                          transition: 'color .25s ease',
                          fontWeight: 600,
                        }}
                      >
                        {verifiedCount.toLocaleString()}
                      </span>{' '}
                      verified
                    </span>
                  </div>

                  <div style={{ position: 'relative' }}>
                    <div
                      style={{
                        position: 'absolute',
                        left: '10%',
                        right: '10%',
                        top: '11px',
                        height: '2px',
                        background: '#ececec',
                      }}
                    ></div>
                    <div
                      style={{
                        position: 'absolute',
                        left: '10%',
                        top: '11px',
                        height: '2px',
                        width: verifyStep <= 1 ? '0%' : `${(verifyStep - 1) * 20}%`,
                        background: '#16a34a',
                        transition: 'width .45s cubic-bezier(.4,.8,.4,1)',
                      }}
                    ></div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(5, 1fr)',
                        position: 'relative',
                      }}
                    >
                      {/* Step 1: Visible */}
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          minWidth: 0,
                          padding: '0 4px',
                        }}
                      >
                        <span
                          style={{
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: verifyStep >= 1 ? '#16a34a' : '#fff',
                            border: verifyStep >= 1 ? '1.5px solid #16a34a' : '1.5px solid #d8d8d8',
                            transform: verifyStep >= 1 ? 'scale(1.08)' : 'scale(1)',
                            boxShadow: verifyStep >= 1 ? '0 0 8px rgba(22,163,74,.4)' : 'none',
                            transition:
                              'background .3s ease, border-color .3s ease, box-shadow .3s ease, transform .45s cubic-bezier(.175, .885, .32, 1.275)',
                            flex: 'none',
                          }}
                        >
                          {verifyStep >= 1 ? (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#fff"
                              strokeWidth="3.5"
                            >
                              <path d="M5 12l5 5L20 7" />
                            </svg>
                          ) : (
                            <span
                              style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                background: '#c8c8c8',
                              }}
                            ></span>
                          )}
                        </span>
                        <span
                          style={{
                            marginTop: '12px',
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: '11px',
                            textAlign: 'center',
                            lineHeight: 1.3,
                            color: verifyStep >= 1 ? '#16a34a' : '#6b6b6b',
                            transition: 'color .3s ease',
                          }}
                        >
                          Visible ≥ 5s
                        </span>
                      </div>

                      {/* Step 2: Signature */}
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          minWidth: 0,
                          padding: '0 4px',
                        }}
                      >
                        <span
                          style={{
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: verifyStep >= 2 ? '#16a34a' : '#fff',
                            border: verifyStep >= 2 ? '1.5px solid #16a34a' : '1.5px solid #d8d8d8',
                            transform: verifyStep >= 2 ? 'scale(1.08)' : 'scale(1)',
                            boxShadow: verifyStep >= 2 ? '0 0 8px rgba(22,163,74,.4)' : 'none',
                            transition:
                              'background .3s ease, border-color .3s ease, box-shadow .3s ease, transform .45s cubic-bezier(.175, .885, .32, 1.275)',
                            flex: 'none',
                          }}
                        >
                          {verifyStep >= 2 ? (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#fff"
                              strokeWidth="3.5"
                            >
                              <path d="M5 12l5 5L20 7" />
                            </svg>
                          ) : (
                            <span
                              style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                background: '#c8c8c8',
                              }}
                            ></span>
                          )}
                        </span>
                        <span
                          style={{
                            marginTop: '12px',
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: '11px',
                            textAlign: 'center',
                            lineHeight: 1.3,
                            color: verifyStep >= 2 ? '#16a34a' : '#6b6b6b',
                            transition: 'color .3s ease',
                          }}
                        >
                          Signature
                        </span>
                      </div>

                      {/* Step 3: Not duplicate */}
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          minWidth: 0,
                          padding: '0 4px',
                        }}
                      >
                        <span
                          style={{
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: verifyStep >= 3 ? '#16a34a' : '#fff',
                            border: verifyStep >= 3 ? '1.5px solid #16a34a' : '1.5px solid #d8d8d8',
                            transform: verifyStep >= 3 ? 'scale(1.08)' : 'scale(1)',
                            boxShadow: verifyStep >= 3 ? '0 0 8px rgba(22,163,74,.4)' : 'none',
                            transition:
                              'background .3s ease, border-color .3s ease, box-shadow .3s ease, transform .45s cubic-bezier(.175, .885, .32, 1.275)',
                            flex: 'none',
                          }}
                        >
                          {verifyStep >= 3 ? (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#fff"
                              strokeWidth="3.5"
                            >
                              <path d="M5 12l5 5L20 7" />
                            </svg>
                          ) : (
                            <span
                              style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                background: '#c8c8c8',
                              }}
                            ></span>
                          )}
                        </span>
                        <span
                          style={{
                            marginTop: '12px',
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: '11px',
                            textAlign: 'center',
                            lineHeight: 1.3,
                            color: verifyStep >= 3 ? '#16a34a' : '#6b6b6b',
                            transition: 'color .3s ease',
                          }}
                        >
                          Not duplicate
                        </span>
                      </div>

                      {/* Step 4: Within budget */}
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          minWidth: 0,
                          padding: '0 4px',
                        }}
                      >
                        <span
                          style={{
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: verifyStep >= 4 ? '#16a34a' : '#fff',
                            border: verifyStep >= 4 ? '1.5px solid #16a34a' : '1.5px solid #d8d8d8',
                            transform: verifyStep >= 4 ? 'scale(1.08)' : 'scale(1)',
                            boxShadow: verifyStep >= 4 ? '0 0 8px rgba(22,163,74,.4)' : 'none',
                            transition:
                              'background .3s ease, border-color .3s ease, box-shadow .3s ease, transform .45s cubic-bezier(.175, .885, .32, 1.275)',
                            flex: 'none',
                          }}
                        >
                          {verifyStep >= 4 ? (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#fff"
                              strokeWidth="3.5"
                            >
                              <path d="M5 12l5 5L20 7" />
                            </svg>
                          ) : (
                            <span
                              style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                background: '#c8c8c8',
                              }}
                            ></span>
                          )}
                        </span>
                        <span
                          style={{
                            marginTop: '12px',
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: '11px',
                            textAlign: 'center',
                            lineHeight: 1.3,
                            color: verifyStep >= 4 ? '#16a34a' : '#6b6b6b',
                            transition: 'color .3s ease',
                          }}
                        >
                          Within budget
                        </span>
                      </div>

                      {/* Step 5: Fraud-cleared */}
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          minWidth: 0,
                          padding: '0 4px',
                        }}
                      >
                        <span
                          style={{
                            width: '22px',
                            height: '22px',
                            borderRadius: '50%',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: verifyStep >= 5 ? '#16a34a' : '#fff',
                            border: verifyStep >= 5 ? '1.5px solid #16a34a' : '1.5px solid #d8d8d8',
                            transform: verifyStep >= 5 ? 'scale(1.08)' : 'scale(1)',
                            boxShadow: verifyStep >= 5 ? '0 0 8px rgba(22,163,74,.4)' : 'none',
                            transition:
                              'background .3s ease, border-color .3s ease, box-shadow .3s ease, transform .45s cubic-bezier(.175, .885, .32, 1.275)',
                            flex: 'none',
                          }}
                        >
                          {verifyStep >= 5 ? (
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#fff"
                              strokeWidth="3.5"
                            >
                              <path d="M5 12l5 5L20 7" />
                            </svg>
                          ) : (
                            <span
                              style={{
                                width: '5px',
                                height: '5px',
                                borderRadius: '50%',
                                background: '#c8c8c8',
                              }}
                            ></span>
                          )}
                        </span>
                        <span
                          style={{
                            marginTop: '12px',
                            fontFamily: "'IBM Plex Mono', monospace",
                            fontSize: '11px',
                            textAlign: 'center',
                            lineHeight: 1.3,
                            color: verifyStep >= 5 ? '#16a34a' : '#6b6b6b',
                            transition: 'color .3s ease',
                          }}
                        >
                          Fraud-cleared
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: '26px',
                      paddingTop: '18px',
                      borderTop: '1px solid #f0f0f0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '13px',
                    }}
                  >
                    <span style={{ color: '#cfcfcf' }}>→</span>
                    <span
                      style={{
                        color: verifyStep >= 5 ? '#16a34a' : '#6b6b6b',
                        transition: 'color .3s ease',
                      }}
                    >
                      {verifyStep >= 5
                        ? 'ledger candidate · verified'
                        : 'ledger candidate · pending'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 4: Trust ── */}
        <section
          id="trust"
          className="wl-sec"
          style={{ padding: '104px 0', background: '#0a0a0a', color: '#fff' }}
        >
          <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0 32px' }}>
            <div style={{ maxWidth: '620px' }}>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '11.5px',
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: '#7a7a7a',
                }}
              >
                Trust
              </div>
              <h2
                style={{
                  fontFamily: "'Instrument Serif', serif",
                  fontWeight: 400,
                  fontSize: 'clamp(32px, 4.4vw, 52px)',
                  lineHeight: 1.04,
                  letterSpacing: '-.014em',
                  margin: '14px 0 0',
                  color: '#fff',
                  textWrap: 'balance',
                }}
              >
                We measure the wait, not your work.
              </h2>
              <p
                style={{
                  fontSize: '17.5px',
                  lineHeight: 1.62,
                  color: '#b5b5b5',
                  margin: '20px 0 0',
                }}
              >
                A hard boundary sits between WaitLayer and everything in your terminal — enforced in
                the client, before any data leaves your machine.
              </p>
            </div>

            <div
              className="wl-2col wlh-in"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '16px',
                marginTop: '44px',
              }}
            >
              <div
                style={{
                  border: '1px solid #1f1f1f',
                  borderRadius: '14px',
                  background: '#0d0d0d',
                  padding: '26px 28px',
                }}
              >
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '11px',
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    color: '#e09a92',
                    marginBottom: '18px',
                  }}
                >
                  Never collected
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '13px 18px' }}>
                  {[
                    'Source code',
                    'Prompts & completions',
                    'Terminal output',
                    'Shell history',
                    'File contents',
                    'Repo & branch names',
                    'Dependency files',
                    'Secrets & env vars',
                  ].map((f) => (
                    <div
                      key={f}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        fontSize: '14.5px',
                        color: '#cfcfcf',
                      }}
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#a8524c"
                        strokeWidth="2"
                        style={{ flex: 'none' }}
                      >
                        <path d="M5 5l14 14M19 5L5 19"></path>
                      </svg>
                      {f}
                    </div>
                  ))}
                </div>
              </div>

              <div
                style={{
                  border: '1px solid #16301f',
                  borderRadius: '14px',
                  background: '#08110b',
                  padding: '26px 28px',
                }}
              >
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '11px',
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    color: '#5a8a6a',
                    marginBottom: '18px',
                  }}
                >
                  All we read — a fixed allowlist
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '13px 18px' }}>
                  {[
                    'Install ID',
                    'Agent type',
                    'Surface type',
                    'Client version',
                    'Eligible duration',
                    'Impression ID',
                    'Click event',
                    'Payout status',
                  ].map((f) => (
                    <div
                      key={f}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        fontSize: '14.5px',
                        color: '#b5b5b5',
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#16a34a"
                        strokeWidth="2.6"
                        style={{ flex: 'none' }}
                      >
                        <path d="M5 12.5l4 4 10-10"></path>
                      </svg>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                marginTop: '26px',
              }}
            >
              <p
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '12.5px',
                  lineHeight: 1.6,
                  color: '#a8a8a8',
                  margin: 0,
                  maxWidth: '560px',
                }}
              >
                The allowlist is enforced in the client. If a field isn't on it, it's never
                assembled into a payload.
              </p>
              <Link
                className="wl-link-u"
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '13px',
                  color: '#fff',
                  flex: 'none',
                }}
                href="/privacy"
              >
                Read the full trust policy →
              </Link>
            </div>
          </div>
        </section>

        {/* ── Section 5: The Line ── */}
        <section
          className="wl-sec"
          style={{ padding: '104px 0', borderBottom: '1px solid #ececec' }}
        >
          <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0 32px' }}>
            <div
              className="wl-2col wlh-in"
              style={{
                display: 'grid',
                gridTemplateColumns: '.82fr 1.18fr',
                gap: '60px',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '11.5px',
                    letterSpacing: '.14em',
                    textTransform: 'uppercase',
                    color: '#6b6b6b',
                  }}
                >
                  The line
                </div>
                <h2
                  style={{
                    fontFamily: "'Instrument Serif', serif",
                    fontWeight: 400,
                    fontSize: 'clamp(32px, 4.4vw, 52px)',
                    lineHeight: 1.04,
                    letterSpacing: '-.014em',
                    margin: '14px 0 0',
                    color: '#0a0a0a',
                    textWrap: 'balance',
                  }}
                >
                  One line. Always labeled.
                </h2>
                <p
                  style={{
                    fontSize: '17px',
                    lineHeight: 1.62,
                    color: '#555',
                    margin: '20px 0 24px',
                    maxWidth: '380px',
                  }}
                >
                  Developer-tool sponsors only — shown once during the wait, never disguised as your
                  work.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {[
                    'No popups',
                    'No takeovers',
                    'No consumer junk',
                    'No hidden native ads',
                    'No misleading placement',
                    'Developer-tool sponsors only',
                  ].map((t) => (
                    <span
                      key={t}
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '11.5px',
                        color: '#666',
                        border: '1px solid #e6e6e6',
                        borderRadius: '6px',
                        padding: '5px 9px',
                        background: '#fafafa',
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <div
                  style={{
                    background: '#0c0c0c',
                    border: '1px solid #1c1c1c',
                    borderRadius: '14px',
                    padding: '22px 24px',
                    boxShadow: 'var(--term-shadow)',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {[
                      {
                        name: 'Neon',
                        desc: 'Serverless Postgres for AI-native apps',
                        color: '#00e599',
                      },
                      {
                        name: 'Sentry',
                        desc: 'Find production bugs before users do',
                        color: '#362d59',
                      },
                      {
                        name: 'Railway',
                        desc: 'Deploy from your terminal in minutes',
                        color: '#13111a',
                      },
                      {
                        name: 'Clerk',
                        desc: 'Authentication built for modern apps',
                        color: '#6c47ff',
                      },
                    ].map((s) => (
                      <div
                        key={s.name}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '10px 76px 62px 1fr',
                          alignItems: 'center',
                          columnGap: '11px',
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '13.5px',
                        }}
                      >
                        <span
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '2px',
                            background: s.color,
                          }}
                        ></span>
                        <span
                          style={{
                            color: '#a8a8a8',
                            fontSize: '11px',
                            letterSpacing: '.05em',
                            textTransform: 'uppercase',
                          }}
                        >
                          Sponsored
                        </span>
                        <span style={{ color: '#e8e8e8' }}>{s.name}</span>
                        <span
                          style={{
                            color: '#b5b5b5',
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          <span style={{ color: '#3a3a3a', marginRight: '9px' }}>·</span>
                          {s.desc}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 6: For Developers ── */}
        <section
          id="developers"
          className="wl-sec"
          style={{ padding: '104px 0', background: '#fafafa', borderBottom: '1px solid #ececec' }}
        >
          <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0 32px' }}>
            <div
              className="wl-2col wlh-in"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '56px',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '11.5px',
                    letterSpacing: '.14em',
                    textTransform: 'uppercase',
                    color: '#6b6b6b',
                  }}
                >
                  For developers
                </div>
                <h2
                  style={{
                    fontFamily: "'Instrument Serif', serif",
                    fontWeight: 400,
                    fontSize: 'clamp(32px, 4.4vw, 52px)',
                    lineHeight: 1.04,
                    letterSpacing: '-.014em',
                    margin: '14px 0 0',
                    color: '#0a0a0a',
                    textWrap: 'balance',
                  }}
                >
                  Join the rewards beta with clear expectations.
                </h2>
                <p
                  style={{
                    fontSize: '17px',
                    lineHeight: 1.62,
                    color: '#555',
                    margin: '20px 0 24px',
                    maxWidth: '440px',
                  }}
                >
                  Active AI-agent users help validate real wait signals without changing how they
                  work. Rewards are not currently accruing in beta.
                </p>
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '11px',
                  }}
                >
                  {[
                    'Private wait-signal beta',
                    'No rewards until attestation is enabled',
                    'Clear status before every sponsor surface',
                    'Stay in your terminal — no workflow change',
                  ].map((li) => (
                    <li
                      key={li}
                      style={{
                        display: 'flex',
                        gap: '11px',
                        alignItems: 'center',
                        fontSize: '15px',
                        color: '#444',
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#16a34a"
                        strokeWidth="2.6"
                        style={{ flex: 'none' }}
                      >
                        <path d="M5 12.5l4 4 10-10"></path>
                      </svg>
                      {li}
                    </li>
                  ))}
                </ul>
                <div
                  style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '26px' }}
                >
                  <Link
                    className="wlh-btn"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      height: '46px',
                      padding: '0 22px',
                      background: '#0a0a0a',
                      color: '#fff',
                      border: 'none',
                      fontSize: '15px',
                      fontWeight: 600,
                      borderRadius: '9px',
                    }}
                    href={isAuthenticated ? dashboardPath : '/auth/signup?role=developer'}
                  >
                    {isAuthenticated ? 'Go to Dashboard' : 'Join the founding beta'}
                  </Link>
                  <Link
                    className="wl-link-u"
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '13px',
                      color: '#666',
                    }}
                    href="/pricing"
                  >
                    Beta details →
                  </Link>
                </div>
              </div>

              <div>
                <div
                  className="wlh-card"
                  style={{
                    border: '1px solid #e6e6e6',
                    borderRadius: '16px',
                    background: '#fff',
                    padding: '28px 30px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '10px',
                      marginBottom: '6px',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "'Instrument Serif', serif",
                        fontSize: '46px',
                        lineHeight: 1,
                        color: '#0a0a0a',
                      }}
                    >
                      60%
                    </span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '12.5px',
                        color: '#6b6b6b',
                      }}
                    >
                      of verified media spend goes to you
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      height: '14px',
                      borderRadius: '7px',
                      overflow: 'hidden',
                      border: '1px solid #e6e6e6',
                      margin: '16px 0 8px',
                      background: '#fafafa',
                    }}
                  >
                    <div
                      style={{
                        width: '60%',
                        background: '#0a0a0a',
                        transformOrigin: 'left center',
                        transform: 'scaleX(1)',
                        transition: 'transform .95s cubic-bezier(.34,.85,.32,1)',
                      }}
                    ></div>
                    <div style={{ width: '30%', background: '#fff' }}></div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '11px',
                      color: '#6b6b6b',
                      marginBottom: '22px',
                    }}
                  >
                    <span>you</span>
                    <span>platform</span>
                  </div>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '11px',
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: '#6b6b6b',
                      marginBottom: '11px',
                    }}
                  >
                    Payout when eligible
                  </div>
                  <div
                    className="wlh-stagger"
                    style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '22px' }}
                  >
                    {['Cash', 'USDC', 'Compute credits'].map((p) => (
                      <span
                        key={p}
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '12.5px',
                          color: '#333',
                          border: '1px solid #e2e2e2',
                          borderRadius: '7px',
                          padding: '7px 11px',
                          background: '#fafafa',
                        }}
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                  <div
                    style={{
                      background: '#fffaf3',
                      border: '1px solid #f0e2c8',
                      borderRadius: '10px',
                      padding: '15px 16px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '9px',
                      }}
                    >
                      <span style={{ color: '#d97706', fontWeight: 'bold' }}>!</span>
                      <span
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '10.5px',
                          letterSpacing: '.1em',
                          textTransform: 'uppercase',
                          color: '#92560a',
                        }}
                      >
                        What beta means
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.62, color: '#6b5e3a' }}>
                      Rewards are disabled during beta. You help validate AI-agent wait states;
                      sponsor-funded rewards can begin only after an independently verifiable
                      attestation integration is enabled.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <EarningsCalculator />
        {/* ── Section 7: For Sponsors ── */}
        <section
          id="sponsors"
          className="wl-sec"
          style={{
            padding: '104px 0',
            background: '#0a0a0a',
            color: '#fff',
            borderBottom: '1px solid #1a1a1a',
          }}
        >
          <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0 32px' }}>
            <div
              className="wl-2col wlh-in"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '56px',
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    background: '#0d0d0d',
                    border: '1px solid #1c1c1c',
                    borderRadius: '16px',
                    padding: '24px 26px',
                    boxShadow: 'var(--term-shadow)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '5px 11px',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '13.5px',
                      color: '#cfcfcf',
                      minWidth: 0,
                      paddingBottom: '18px',
                      borderBottom: '1px solid #181818',
                    }}
                  >
                    <span
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '2px',
                        background: '#00e599',
                        flex: 'none',
                      }}
                    ></span>
                    <span
                      style={{
                        color: '#a8a8a8',
                        flex: 'none',
                        fontSize: '11px',
                        letterSpacing: '.05em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Sponsored
                    </span>
                    <span style={{ color: '#e8e8e8', flex: 'none' }}>Your tool</span>
                    <span style={{ color: '#3a3a3a', flex: 'none' }}>·</span>
                    <span style={{ color: '#b5b5b5', minWidth: 0 }}>
                      One developer-relevant line
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '12px',
                      marginTop: '18px',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '10.5px',
                          letterSpacing: '.06em',
                          textTransform: 'uppercase',
                          color: '#a8a8a8',
                          marginBottom: '6px',
                        }}
                      >
                        Impressions
                      </div>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '7px',
                          fontSize: '13px',
                          color: '#b5b5b5',
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#5fbd83"
                          strokeWidth="2.6"
                          style={{ flex: 'none' }}
                        >
                          <path d="M5 12.5l4 4 10-10"></path>
                        </svg>
                        verified
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '10.5px',
                          letterSpacing: '.06em',
                          textTransform: 'uppercase',
                          color: '#a8a8a8',
                          marginBottom: '6px',
                        }}
                      >
                        Delivery
                      </div>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '7px',
                          fontSize: '13px',
                          color: '#b5b5b5',
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#5fbd83"
                          stroke-width="2.6"
                          style={{ flex: 'none' }}
                        >
                          <path d="M5 12.5l4 4 10-10"></path>
                        </svg>
                        fraud-reviewed
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '10.5px',
                          letterSpacing: '.06em',
                          textTransform: 'uppercase',
                          color: '#a8a8a8',
                          marginBottom: '6px',
                        }}
                      >
                        Audience
                      </div>
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '7px',
                          fontSize: '13px',
                          color: '#b5b5b5',
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="#5fbd83"
                          stroke-width="2.6"
                          style={{ flex: 'none' }}
                        >
                          <path d="M5 12.5l4 4 10-10"></path>
                        </svg>
                        dev-tools only
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: '18px',
                      paddingTop: '16px',
                      borderTop: '1px solid #181818',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '6px 16px',
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '11.5px',
                      color: '#7a7a7a',
                    }}
                  >
                    <span>reporting:</span>
                    <span style={{ color: '#cfcfcf' }}>1,000 impressions</span>
                    <span style={{ color: '#3a3a3a' }}>·</span>
                    <span style={{ color: '#cfcfcf' }}>38 clicks</span>
                    <span style={{ color: '#3a3a3a' }}>·</span>
                    <span style={{ color: '#cfcfcf' }}>$20 CPM</span>
                    <span style={{ color: '#3a3a3a' }}>·</span>
                    <span style={{ color: '#5fbd83' }}>$0.52 CPC</span>
                  </div>
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: '11.5px',
                    letterSpacing: '.14em',
                    textTransform: 'uppercase',
                    color: '#a78bfa',
                  }}
                >
                  For sponsors
                </div>
                <h2
                  style={{
                    fontFamily: "'Instrument Serif', serif",
                    fontWeight: 400,
                    fontSize: 'clamp(32px, 4.4vw, 52px)',
                    lineHeight: 1.04,
                    letterSpacing: '-.014em',
                    margin: '14px 0 0',
                    color: '#fff',
                    textWrap: 'balance',
                  }}
                >
                  Reach builders where they actually work.
                </h2>
                <p
                  style={{
                    fontSize: '17px',
                    lineHeight: 1.62,
                    color: '#b5b5b5',
                    margin: '20px 0 24px',
                    maxWidth: '440px',
                  }}
                >
                  Privacy-preserving access to AI-native developers during real coding sessions —
                  verified, fraud-reviewed, and developer-tools only. From $750/mo.
                </p>
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '11px',
                  }}
                >
                  {[
                    'Verified five-second impressions',
                    'Fraud-reviewed delivery',
                    'Developer-tool environment only',
                    'Click and campaign reporting',
                  ].map((li) => (
                    <li
                      key={li}
                      style={{
                        display: 'flex',
                        gap: '11px',
                        alignItems: 'center',
                        fontSize: '15px',
                        color: '#cfcfcf',
                      }}
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#5fbd83"
                        strokeWidth="2.6"
                        style={{ flex: 'none' }}
                      >
                        <path d="M5 12.5l4 4 10-10"></path>
                      </svg>
                      {li}
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: '24px' }}>
                  <div
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '10.5px',
                      letterSpacing: '.1em',
                      textTransform: 'uppercase',
                      color: '#a8a8a8',
                      marginBottom: '11px',
                    }}
                  >
                    Founding sponsors get
                  </div>
                  <div
                    className="wlh-stagger"
                    style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
                  >
                    {[
                      'Priority pricing',
                      'Discounted founding CPM',
                      'Category exclusivity',
                      'Creative feedback',
                      'Rollover protection',
                    ].map((tag) => (
                      <span
                        key={tag}
                        style={{
                          fontFamily: "'IBM Plex Mono', monospace",
                          fontSize: '11.5px',
                          color: '#bdbdbd',
                          border: '1px solid #262626',
                          borderRadius: '7px',
                          padding: '6px 10px',
                          background: '#0f0f0f',
                        }}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <div
                  style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '26px' }}
                >
                  <Link
                    className="wlh-btn"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      height: '46px',
                      padding: '0 22px',
                      background: '#fff',
                      color: '#0a0a0a',
                      fontSize: '15px',
                      fontWeight: 600,
                      borderRadius: '9px',
                    }}
                    href="/auth/signup?role=advertiser"
                  >
                    Reserve a sponsor slot
                  </Link>
                  <Link
                    className="wl-link-u"
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '13px',
                      color: '#cfcfcf',
                    }}
                    href="/pricing"
                  >
                    See pricing →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 8: The Network ── */}
        <section
          className="wl-sec"
          style={{ padding: '100px 0', borderBottom: '1px solid #ececec' }}
        >
          <div style={{ maxWidth: '1180px', margin: '0 auto', padding: '0 32px' }}>
            <div style={{ maxWidth: '720px' }}>
              <div
                style={{
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '11.5px',
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: '#6b6b6b',
                }}
              >
                The network
              </div>
              <h2
                style={{
                  fontFamily: "'Instrument Serif', serif",
                  fontWeight: 400,
                  fontSize: 'clamp(32px, 4.4vw, 52px)',
                  lineHeight: 1.04,
                  letterSpacing: '-.014em',
                  margin: '14px 0 0',
                  color: '#0a0a0a',
                  textWrap: 'balance',
                }}
              >
                We're building the network layer for AI-agent attention.
              </h2>
              <p
                style={{
                  fontSize: '17.5px',
                  lineHeight: 1.62,
                  color: '#555',
                  margin: '20px 0 0',
                  maxWidth: '600px',
                }}
              >
                Rendering a sponsor line isn't the moat. Verifying quality, routing demand, and
                settling value across the agent stack is — measurement, marketplace, and settlement
                for AI-agent attention.
              </p>
            </div>

            <div
              className="wl-cards"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '16px',
                marginTop: '44px',
              }}
            >
              {/* Card 1: Now */}
              <div
                className="wlh-card wlh-in"
                style={{
                  border: '1px solid #e6e6e6',
                  borderRadius: '14px',
                  background: '#fff',
                  padding: '24px 26px',
                  height: '100%',
                  animationDelay: '0ms',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '9px',
                    marginBottom: '18px',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: '#16a34a',
                      }}
                    ></span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '11.5px',
                        letterSpacing: '.1em',
                        textTransform: 'uppercase',
                        color: '#666',
                      }}
                    >
                      Now
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '10.5px',
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: '#6b6b6b',
                    }}
                  >
                    Measurement
                  </span>
                </div>
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '11px',
                  }}
                >
                  {[
                    'Claude Code status line',
                    'Local verification ledger',
                    'Founding developer beta',
                  ].map((item) => (
                    <li
                      key={item}
                      style={{
                        fontSize: '14.5px',
                        color: '#444',
                        paddingLeft: '14px',
                        position: 'relative',
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '9px',
                          width: '4px',
                          height: '4px',
                          borderRadius: '50%',
                          background: '#cfcfcf',
                        }}
                      ></span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Card 2: Next */}
              <div
                className="wlh-card wlh-in"
                style={{
                  border: '1px solid #e6e6e6',
                  borderRadius: '14px',
                  background: '#fff',
                  padding: '24px 26px',
                  height: '100%',
                  animationDelay: '100ms',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '9px',
                    marginBottom: '18px',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: '#d97706',
                      }}
                    ></span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '11.5px',
                        letterSpacing: '.1em',
                        textTransform: 'uppercase',
                        color: '#666',
                      }}
                    >
                      Next
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '10.5px',
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: '#6b6b6b',
                    }}
                  >
                    Marketplace
                  </span>
                </div>
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '11px',
                  }}
                >
                  {[
                    'Funded sponsor campaigns',
                    'Qualified actions & compute credits',
                    'Cash & USDC payouts',
                    'Codex CLI',
                  ].map((item) => (
                    <li
                      key={item}
                      style={{
                        fontSize: '14.5px',
                        color: '#444',
                        paddingLeft: '14px',
                        position: 'relative',
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '9px',
                          width: '4px',
                          height: '4px',
                          borderRadius: '50%',
                          background: '#cfcfcf',
                        }}
                      ></span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Card 3: Later */}
              <div
                className="wlh-card wlh-in"
                style={{
                  border: '1px solid #e6e6e6',
                  borderRadius: '14px',
                  background: '#fff',
                  padding: '24px 26px',
                  height: '100%',
                  animationDelay: '200ms',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '9px',
                    marginBottom: '18px',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '9px' }}>
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: '#6d28d9',
                      }}
                    ></span>
                    <span
                      style={{
                        fontFamily: "'IBM Plex Mono', monospace",
                        fontSize: '11.5px',
                        letterSpacing: '.1em',
                        textTransform: 'uppercase',
                        color: '#666',
                      }}
                    >
                      Later
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: "'IBM Plex Mono', monospace",
                      fontSize: '10.5px',
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: '#6b6b6b',
                    }}
                  >
                    Settlement
                  </span>
                </div>
                <ul
                  style={{
                    listStyle: 'none',
                    margin: 0,
                    padding: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '11px',
                  }}
                >
                  {[
                    'Cross-agent surfaces — tmux, PTY, Aider, Gemini',
                    'Compute-credit settlement',
                    'Quality scoring & marketplace',
                  ].map((item) => (
                    <li
                      key={item}
                      style={{
                        fontSize: '14.5px',
                        color: '#444',
                        paddingLeft: '14px',
                        position: 'relative',
                      }}
                    >
                      <span
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: '9px',
                          width: '4px',
                          height: '4px',
                          borderRadius: '50%',
                          background: '#cfcfcf',
                        }}
                      ></span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── Section 9: Stop Giving Away ── */}
        <section
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: '#0a0a0a',
            color: '#fff',
            padding: '138px 0',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              gridTemplateColumns: 'repeat(22, 1fr)',
              gridTemplateRows: 'repeat(11, 1fr)',
              padding: '44px 3%',
              pointerEvents: 'none',
              maskImage: 'radial-gradient(ellipse 62% 62% at 50% 50%, transparent 26%, #000 80%)',
              WebkitMaskImage:
                'radial-gradient(ellipse 62% 62% at 50% 50%, transparent 26%, #000 80%)',
            }}
          >
            {Array.from({ length: 242 }).map((_, idx) => {
              const col = idx % 22;
              const row = Math.floor(idx / 22);
              const dist = Math.sqrt((col - 10.5) ** 2 + (row - 5) ** 2);
              const delay = (dist * 0.18).toFixed(2);
              return (
                <span
                  key={idx}
                  className="wlh-node"
                  style={{
                    animationDelay: `${delay}s`,
                    justifySelf: 'center',
                    alignSelf: 'center',
                  }}
                ></span>
              );
            })}
          </div>

          <div
            style={{
              maxWidth: '1000px',
              margin: '0 auto',
              padding: '0 32px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <div className="wlh-in" style={{ textAlign: 'center' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '9px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '11.5px',
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: '#7f7f7f',
                  marginBottom: '26px',
                }}
              >
                <span
                  className="wl-dot"
                  style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    background: 'var(--accent,#16a34a)',
                    display: 'inline-block',
                  }}
                ></span>
                The verified attention network
              </div>
              <h2
                style={{
                  fontFamily: "'Instrument Serif', serif",
                  fontWeight: 400,
                  fontSize: 'clamp(40px, 5.6vw, 70px)',
                  lineHeight: 1,
                  letterSpacing: '-.02em',
                  margin: '0 auto 18px',
                  maxWidth: '680px',
                  color: '#fff',
                  textWrap: 'balance',
                }}
              >
                Stop giving away your wait time.
              </h2>
              <p
                style={{
                  fontSize: '18.5px',
                  lineHeight: 1.6,
                  color: '#b5b5b5',
                  margin: '0 auto 34px',
                  maxWidth: '480px',
                }}
              >
                Join the founding beta and help validate the wait signals you already experience.
              </p>

              <div
                style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center' }}
              >
                <Link
                  className="wlh-btn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: '52px',
                    padding: '0 30px',
                    background: '#fff',
                    color: '#0a0a0a',
                    fontSize: '16px',
                    fontWeight: 600,
                    borderRadius: '9px',
                  }}
                  href={isAuthenticated ? dashboardPath : '/auth/signup?role=developer'}
                >
                  {isAuthenticated ? 'Go to Dashboard' : 'Join the founding beta'}
                </Link>
                <Link
                  className="wlh-btn"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: '52px',
                    padding: '0 30px',
                    background: 'transparent',
                    color: '#fff',
                    border: '1px solid #3a3a3a',
                    fontSize: '16px',
                    fontWeight: 600,
                    borderRadius: '9px',
                  }}
                  href={
                    isAuthenticated && user?.role === 'advertiser'
                      ? '/advertiser'
                      : '/auth/signup?role=advertiser'
                  }
                >
                  Become a sponsor
                </Link>
              </div>

              <div
                style={{
                  marginTop: '20px',
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '12px',
                  color: '#a8a8a8',
                }}
              >
                No guaranteed earnings · your work stays yours · cancel anytime
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
