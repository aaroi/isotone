import { trails } from './trails.js';

function TrailCard({ trail }) {
  return (
    <article className="card">
      <h2>{trail.name}</h2>
      <p className="card-length">{trail.length}</p>
      <p>{trail.note}</p>
    </article>
  );
}

export default function Home() {
  return (
    <div id="app" className="page">
      <header className="site-header">
        <a className="logo" href="/">
          Trail Finder
        </a>
        <nav aria-label="Main">
          <a href="/">Trails</a>
          <a href="/">Maps</a>
          <a href="/">About</a>
        </nav>
      </header>
      <main>
        <section className="hero">
          <h1>Find your next trail</h1>
          <p>Hand-picked routes near you, with honest notes on every one.</p>
          <button className="cta" type="button">
            Sign up
          </button>
        </section>
        <section className="card-grid" aria-label="Featured trails">
          {trails.map((trail) => (
            <TrailCard key={trail.id} trail={trail} />
          ))}
        </section>
      </main>
    </div>
  );
}
