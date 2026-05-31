import Link from 'next/link';

export default function Home() {
  return (
    <div
      style={{
        background: '#0f0f0f',
        color: '#e0e0e0',
        minHeight: '100vh',
        fontFamily: 'var(--font-geist-mono), monospace',
        padding: '2rem',
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 400, marginBottom: '1.5rem' }}>
        Living World
      </h1>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <Link href="/world" style={{ color: '#e0e0e0', textDecoration: 'underline' }}>
          World View
        </Link>
        <Link href="/chronicle" style={{ color: '#e0e0e0', textDecoration: 'underline' }}>
          Chronicle
        </Link>
      </nav>
    </div>
  );
}
