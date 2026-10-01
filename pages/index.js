import Head from 'next/head';
import Link from 'next/link';
import { fetchAllSheetData } from '@/lib/sheets';
import {
  computeWeeklyLeaderboard,
  computeRangeLeaderboard,
  previousMonthBounds,
} from '@/lib/leaderboard';
import Top3Banner from '@/components/Top3Banner';

export async function getServerSideProps() {
  try {
    const data = await fetchAllSheetData();
    const { weekEnded, ranked } = computeWeeklyLeaderboard(data.summary, data.agents);
    const top3 = ranked.slice(0, 3).map((r) => ({
      name: r.name,
      total: r.total,
      profilePictureLink: r.profilePictureLink,
    }));
    const timeZone = process.env.APP_TIMEZONE || 'America/Edmonton';
    const lastMonth = previousMonthBounds(timeZone);
    const lastMonthTop3 = computeRangeLeaderboard(
      data.responseRows,
      data.header,
      data.agents,
      lastMonth.start,
      lastMonth.end
    )
      .filter((r) => r.total > 0)
      .slice(0, 3)
      .map((r) => ({
        name: r.name,
        total: r.total,
        profilePictureLink: r.profilePictureLink,
      }));
    return {
      props: {
        top3,
        weekEnded: weekEnded || null,
        lastMonthTop3,
        lastMonthStart: lastMonth.start,
      },
    };
  } catch (err) {
    console.error('home: failed to read sheet', err);
    return { props: { top3: [], weekEnded: null, lastMonthTop3: [], lastMonthStart: null } };
  }
}

export default function Home({ top3, weekEnded, lastMonthTop3, lastMonthStart }) {
  return (
    <main className="home-page">
      <Head>
        <title>MDM Accountability Tracker</title>
      </Head>
      <Top3Banner
        top3={top3}
        weekEnded={weekEnded}
        lastMonthTop3={lastMonthTop3}
        lastMonthStart={lastMonthStart}
      />
      <p>Agents: use the private link sent to you to log today&apos;s activity.</p>
      <p className="home-admin-link">
        <Link href="/admin">Admin login</Link>
      </p>
    </main>
  );
}
