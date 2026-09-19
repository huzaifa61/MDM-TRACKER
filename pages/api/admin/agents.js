import { fetchAllSheetData } from '@/lib/sheets';
import { generateToken } from '@/lib/tokens';
import { isAdminRequest } from '@/lib/adminAuth';

export default async function handler(req, res) {
  if (!isAdminRequest(req)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  let data;
  try {
    data = await fetchAllSheetData();
  } catch (err) {
    console.error('admin/agents: failed to read sheet', err);
    return res.status(502).json({ error: 'sheet_read_failed' });
  }

  const baseUrl = process.env.APP_BASE_URL || '';
  const agents = data.agents.map((a) => ({
    ...a,
    link: `${baseUrl}/entry/${generateToken(a.email)}`,
  }));

  return res.status(200).json({ agents });
}
