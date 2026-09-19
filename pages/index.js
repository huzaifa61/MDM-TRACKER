import Head from 'next/head';
import Link from 'next/link';

export default function Home() {
  return (
    <main className="home-page">
      <Head>
        <title>MDM Accountability Tracker</title>
      </Head>
      <h1>MDM Accountability Tracker</h1>
      <p>Agents: use your private link to log today&apos;s activity.</p>
      <p>
        Admins: visit <Link href="/admin">/admin</Link> to find agent links.
      </p>
    </main>
  );
}
